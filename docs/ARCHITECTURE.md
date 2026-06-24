# MM Chat Service Architecture

> **Note**: For system-level architecture (System Context and Container diagrams), see `mm-infra/docs/ARCHITECTURE.md`.

---

## Overview

MM Chat Service (`mm-chat-service`) is a **socket-first real-time messaging engine** for the MarketMate platform. It runs as a dedicated **NestJS** service using **Socket.IO** for WebSocket communication, **PostgreSQL** for message persistence, and **Redis** for session validation shared with SpringMate.

Authentication is **delegated to SpringMate** — the chat service verifies JWT cookies, resolves users via a Redis cache-first path, and falls back to a SpringMate internal API. There is **no REST chat API**; all client operations are WebSocket events.

**Implemented capabilities:**

- Authenticated Socket.IO connections (httpOnly `auth_token` cookie)
- 1:1 conversations: find-or-create, room join, participant authorization on send
- Text message persist, realtime delivery, and inbox notifications
- **Persistent message history** (`get_messages`) — thread survives page refresh
- **Conversation list bootstrap** (`list_conversations`) — sidebar survives page refresh
- **MarketMate Angular client** integrated via `socket.io-client`

**Out of scope:** read receipts, typing indicators, presence, attachments, search, moderation.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     MM Chat Service (NestJS)                    │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              ChatGateway (Socket.IO)                    │   │
│  │  join_conversation | join_conversation_by_id           │   │
│  │  list_conversations | get_messages | send_message → new_message │   │
│  └──────────────────────────────────────────────────────────┘   │
│         │                    │                    │             │
│  ┌──────▼──────┐    ┌────────▼────────┐   ┌──────▼──────┐      │
│  │ AuthModule  │    │  ChatModule     │   │ CoreModule  │      │
│  │ WsJwtGuard  │    │ ConversationSvc │   │ AppLogger   │      │
│  │ AuthService │    │ MessageService  │   │ ContextSvc  │      │
│  └──────┬──────┘    └────────┬────────┘   └─────────────┘      │
│         │                    │                                  │
│  ┌──────▼──────┐    ┌────────▼────────┐                         │
│  │ RedisModule │    │ TypeORM (PG)    │                         │
│  └─────────────┘    └─────────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐
│    Redis     │    │  PostgreSQL  │    │  SpringMate Backend  │
│ auth:session │    │   mm_chat    │    │  (JWT issuer, session │
│    :*        │    │              │    │   source of truth)   │
└──────────────┘    └──────────────┘    └──────────────────────┘
        ▲                                        ▲
        └──────── shared auth cache ─────────────┘
```

### Key Architectural Decisions

- **Socket-first, no REST chat API**: All messaging flows through `ChatGateway`; there are no `@Controller` classes.
- **Delegated authentication**: The chat service never issues tokens; it verifies SpringMate JWTs and resolves sessions.
- **Redis cache-first session resolution**: Reads `auth:session:{sessionId}` written by SpringMate; falls back to internal HTTP endpoint on cache miss.
- **Dedicated database**: Uses PostgreSQL database `mm_chat`, separate from SpringMate's `marketmate` database.
- **Schema via migrations only**: `synchronize: false`; TypeORM migrations must be run explicitly.
- **HTTPS-only bootstrap**: `main.ts` reads TLS certificates from `/certs/` (mounted in Docker).

---

## Domain Architecture

The service is organized into five NestJS modules under `src/`:

| Module | Purpose | Key Components |
|--------|---------|----------------|
| **AppModule** | Root composition, global config, middleware | `ConfigModule`, `TypeOrmModule`, module imports |
| **AuthModule** | JWT verification and session → userUuid resolution | `AuthService`, `WsJwtGuard`, `JwtModule`, `cookie.util.ts` |
| **ChatModule** | Conversations, messages, WebSocket gateway | `ChatGateway`, `ConversationService`, `MessageService`, entities |
| **RedisModule** | Global ioredis client | `redisProvider`, `REDIS_CLIENT` token |
| **CoreModule** | Cross-cutting logging and request context | `AppLogger`, `ContextService`, `HttpContextMiddleware` |

There are **no DTO classes** — WebSocket payloads are inline TypeScript object types in `ChatGateway` handler signatures.

---

## Package Structure

```
mm-chat-service/
├── src/
│   ├── main.ts                      # HTTPS bootstrap, CORS
│   ├── app.module.ts                # Root module
│   ├── data-source.ts               # TypeORM CLI data source
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── cookie.util.ts           # Parse auth_token from Cookie header
│   │   ├── guards/
│   │   │   └── ws-jwt.auth.guard.ts # Per-message auth guard
│   │   └── services/
│   │       └── auth.service.ts      # JWT verify + Redis/Spring resolve
│   ├── chat/
│   │   ├── chat.module.ts
│   │   ├── entities/
│   │   │   ├── conversation.entity.ts
│   │   │   └── message.entity.ts
│   │   ├── gateway/
│   │   │   └── chat.gateway.ts      # All WebSocket events
│   │   └── services/
│   │       ├── conversation.service.ts
│   │       └── message.service.ts
│   ├── config/
│   │   ├── database.config.ts
│   │   └── env.validation.ts        # Joi startup validation
│   ├── core/
│   │   ├── core.module.ts
│   │   ├── context/
│   │   │   ├── context.service.ts   # AsyncLocalStorage
│   │   │   └── http-context.middleware.ts
│   │   └── logger/
│   │       └── app.logger.ts        # Context-enriched Nest Logger
│   ├── migrations/
│   │   ├── 1766773317623-InitChatSchema.ts
│   │   └── 1766775567110-InitChatSchema.ts
│   ├── redis/
│   │   ├── redis.module.ts
│   │   └── redis.provider.ts
│   ├── shared/
│   │   ├── app.constants.ts
│   │   └── spring-api.urls.ts       # URL constants (not wired into AuthService)
│   └── env/
│       └── .env                     # Local/Docker env (not committed pattern)
├── docs/
│   └── ARCHITECTURE.md
├── certs/                           # TLS PEM files for HTTPS
├── test/
│   └── app.e2e-spec.ts              # Stale placeholder (expects REST / route)
└── DOCKERFILE.local
```

---

## Authentication Flow

Authentication is cookie-based. The browser sends the `auth_token` httpOnly cookie (issued by SpringMate on login) with the Socket.IO handshake.

```
Browser                          Chat Service                    SpringMate / Redis
   │                                  │                                │
   │  Socket.IO connect (cookie)      │                                │
   ├─────────────────────────────────►│                                │
   │                                  │  getCookieValue('auth_token')  │
   │                                  │  jwtService.verify(token)      │
   │                                  │  extract sessionId from sub    │
   │                                  │                                │
   │                                  │  EXISTS auth:session:{id}      │
   │                                  ├───────────────────────────────►│ Redis
   │                                  │◄───────────────────────────────┤
   │                                  │  GET + JSON.parse → userUuid   │
   │                                  │  (or fallback if miss/invalid) │
   │                                  │                                │
   │                                  │  POST /internal/v1/auth/       │
   │                                  │       resolve_session            │
   │                                  │  Header: X-SERVICE-KEY         │
   │                                  ├───────────────────────────────►│
   │                                  │◄───────────────────────────────┤
   │                                  │  { data: { userUuid } }        │
   │                                  │                                │
   │                                  │  socket.data.sessionId         │
   │                                  │  socket.data.userUuid          │
   │◄─────────────────────────────────┤  connection accepted           │
```

### JWT Details

- **Cookie name**: `auth_token`
- **Secret**: `JWT_SECRET` env var (must match SpringMate `JwtTokenProvider`)
- **Session ID extraction**: `payload.sessionId ?? payload.sub` — SpringMate uses JWT `sub` as the session ID (`JwtTokenProvider.generateToken`)

### Auth Enforcement Points

1. **Socket.IO middleware** (`ChatGateway.afterInit`) — runs on handshake before connection is accepted.
2. **`WsJwtGuard`** — applied at gateway class level; re-authenticates on each `@SubscribeMessage` if `socket.data` is not already populated.

On failure, middleware calls `next(new Error('Unauthorized'))`; the guard emits `auth_error` and disconnects the client.

---

## Session Resolution Flow

`AuthService.resolveUserUuid(sessionId)` implements a two-tier strategy:

| Step | Action | File |
|------|--------|------|
| 1 | Build Redis key `auth:session:{sessionId}` | `auth.service.ts` |
| 2 | `redis.exists(key)` — if missing, fall back to Spring | `auth.service.ts` |
| 3 | `redis.get(key)` → `JSON.parse(raw)` → read `userUuid` | `auth.service.ts` |
| 4 | On parse failure or missing `userUuid`, fall back to Spring | `auth.service.ts` |
| 5 | `POST` to `AUTH_RESOLVE_URL` or `SPRING_BASE_URL` with `{ sessionId }` and `X-SERVICE-KEY` header | `auth.service.ts` |
| 6 | 10-second abort timeout on fetch | `auth.service.ts` |
| 7 | Return `response.data.userUuid` from SpringMate `Response<T>` wrapper | `auth.service.ts` |

### Redis Key Compatibility

SpringMate stores `CachedAuthentication` objects in Redis using `GenericJackson2JsonRedisSerializer`. Serialized values include a `@class` type hint and a `userUuid` string field. The chat service parses this as JSON and reads `parsed.userUuid` directly.

Both services share the key prefix `auth:session:` (SpringMate: `AuthCacheService.KEY_PREFIX`).

### SpringMate Internal Endpoint

| Property | Value |
|----------|-------|
| Path | `POST /internal/v1/auth/resolve_session` |
| Auth | `X-SERVICE-KEY` header (must match `app.internal.service.key` in SpringMate) |
| Request body | `{ "sessionId": "<uuid>" }` |
| Response | `{ "data": { "userUuid": "<uuid>" }, ... }` |
| Controller | `InternalAuthController` |

Local Docker URL (from `src/env/.env`): `https://backend:8080/internal/v1/auth/resolve_session`

---

## WebSocket Lifecycle

### Connection

1. Client connects with `withCredentials: true` so cookies are sent.
2. Handshake middleware authenticates and sets `socket.data.sessionId` and `socket.data.userUuid`.
3. `handleConnection` joins the socket to personal room `user:{userUuid}`.
4. Personal rooms enable message delivery when the receiver is online but not joined to the conversation room.

### Disconnection

`handleDisconnect` logs a warning. No presence state is updated, no cleanup beyond Socket.IO defaults.

### Socket.IO Rooms

| Room Pattern | Purpose |
|--------------|---------|
| `user:{userUuid}` | Personal inbox room; joined on connect |
| `conversation:{conversationId}` | Conversation room; joined via `join_conversation` or `join_conversation_by_id` |

### CORS

Configured in both `main.ts` (HTTP) and `@WebSocketGateway` decorator (WebSocket). Origins from `ALLOWED_APP_ORIGINS` (comma-separated) with localhost/marketmate.local defaults.

---

## Conversation Lifecycle

### Find or Create (`join_conversation`)

**Event**: `join_conversation`

**Payload**: `{ otherUserUuid: string }`

**Flow**:

1. Read `currentUserUuid` from `client.data.userUuid`.
2. `ConversationService.findOrCreateConversation(currentUserUuid, otherUserUuid)`.
3. User pair is **normalized** (lexicographic sort) into `userOneId` / `userTwoId` with a unique index.
4. Socket joins room `conversation:{conversationId}`.
5. Returns `{ conversationId }`.

**Authorization**: Does not verify `otherUserUuid` exists in SpringMate. Does not prevent self-conversation.

### Join by ID (`join_conversation_by_id`)

**Event**: `join_conversation_by_id`

**Payload**: `{ conversationId: string }`

**Flow**:

1. Load conversation by ID.
2. Verify current user is `userOneId` or `userTwoId`.
3. Join conversation room.
4. Returns `{ conversationId, success: true }`, or `{ success: false, error: { code, message } }` on failure.

Uses `ConversationService.isParticipant` for membership verification.

---

## Message Lifecycle

### Send Message (`send_message`)

**Event**: `send_message`

**Payload**: `{ conversationId: string, content: string }`

**Flow**:

1. Load conversation by ID; reject if not found or sender is not a participant (see [Authorization](#message-authorization)).
2. Persist message via `MessageService.saveMessage(conversationId, senderUuid, content)`.
3. Resolve receiver UUID via `ConversationService.getOtherParticipant`.
4. Build payload: `{ id, conversationId, senderUuid, content, createdAt }`.
5. Emit `new_message` to conversation room (excluding sender via `client.to()`).
6. Emit `new_message` to receiver's personal room `user:{receiverUuid}`.
7. Emit `conversation_updated` to receiver's personal room with last message summary.
8. Return `{ success: true, message: {...} }` to sender.

On authorization failure the message is **not** persisted and **no events** are emitted. The handler returns `{ success: false, error: { code, message } }`.

### Message Authorization

Before persisting, `send_message` loads the conversation and verifies membership using `ConversationService.isParticipant` (same helper used by `join_conversation_by_id`):

| Check | Error code | Response |
|-------|------------|----------|
| Conversation not found | `CONVERSATION_NOT_FOUND` | `{ success: false, error: { code, message } }` |
| Sender not `userOneId` or `userTwoId` | `NOT_PARTICIPANT` | `{ success: false, error: { code, message } }` |

### Receive Message (`new_message`)

Clients listen for `new_message` with the persisted message payload.

### Inbox Update (`conversation_updated`)

Emitted to the receiver's personal room:

```json
{
  "conversationId": "uuid",
  "lastMessage": { "id", "content", "senderUuid", "createdAt" },
  "senderUuid": "uuid"
}
```

### Message History (`get_messages`)

**Event**: `get_messages`

**Payload**: `{ conversationId: string, limit?: number, offset?: number }`

**Flow**:

1. Load conversation by ID; reject if not found or requester is not a participant (same checks as `send_message`).
2. Query PostgreSQL via `MessageService.getMessagesByConversation(conversationId, limit, offset)`.
3. Return `{ success: true, messages: [...] }` where each message uses `{ id, conversationId, senderUuid, content, createdAt }`.

**Ordering**: Messages are returned **oldest-first** (`createdAt ASC`). This matches the frontend thread renderer, which displays messages top-to-bottom in chronological order. Default `limit` is `50`; clients may request up to their local cap (MarketMate uses `200`).

On failure: `{ success: false, error: { code, message } }` — no messages are returned.

### Conversation List (`list_conversations`)

**Event**: `list_conversations`

**Payload**: `{}` (empty — user identity from authenticated socket)

**Flow**:

1. Read `userUuid` from `client.data.userUuid`.
2. Query all conversations where `user_one_id = userUuid OR user_two_id = userUuid`.
3. Batch-fetch latest message per conversation via `MessageService.getLatestByConversationIds()` (PostgreSQL `DISTINCT ON`, no N+1).
4. Derive `otherParticipantUuid` via `ConversationService.getOtherParticipant()`.
5. Sort by `COALESCE(lastMessage.createdAt, conversation.createdAt) DESC`.
6. Return `{ success: true, conversations: [...] }`.

**Query strategy:** Two-step batch — (1) load participant conversations, (2) single `DISTINCT ON (conversation_id)` query for latest messages. No schema changes or caching required.

**Frontend bootstrap:** MarketMate `ChatShellComponent` calls this on `/chat` init so the sidebar survives page refresh.

On failure: `{ success: false, error: { code, message } }`.

### Read Receipts

The `messages.read_at` column exists in the entity and migration schema but **no code reads or writes it**.

---

## Redis Usage

| Usage | Key Pattern | Operations | Module |
|-------|-------------|------------|--------|
| Session validation cache (read-only) | `auth:session:{sessionId}` | `exists`, `get` | `AuthService` |

The chat service does **not** write to Redis. It only reads session cache entries populated by SpringMate's `AuthCacheService`.

### Redis Client Configuration

- Library: `ioredis`
- Provider: `redis.provider.ts` (global `REDIS_CLIENT` token)
- Options: `lazyConnect: true`, `maxRetriesPerRequest: 3`
- Env: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` (optional)

No chat-specific keys (presence, typing, pub/sub fan-out) are used.

---

## Database Design

**Database**: `mm_chat` (PostgreSQL 15, separate from SpringMate's `marketmate`)

**ORM**: TypeORM with `synchronize: false`

### Tables

#### `conversations`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `uuid_generate_v4()` |
| `user_one_id` | UUID | Normalized (lower UUID of pair) |
| `user_two_id` | UUID | Normalized (higher UUID of pair) |
| `created_at` | TIMESTAMP | Auto-set |

**Index**: Unique on `(user_one_id, user_two_id)`

#### `messages`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `uuid_generate_v4()` |
| `conversation_id` | UUID FK | CASCADE delete |
| `sender_id` | UUID | Renamed from `sender_uuid` in migration 2 |
| `content` | TEXT | Plain text only |
| `created_at` | TIMESTAMP | Auto-set |
| `read_at` | TIMESTAMP NULL | **Unused in application code** |

### Migrations

| Migration | Action |
|-----------|--------|
| `1766773317623-InitChatSchema` | Creates `conversations` and `messages` tables |
| `1766775567110-InitChatSchema` | Renames `sender_uuid` → `sender_id` |

Migrations are **not** run automatically on container start. Run manually:

```bash
docker exec chat-engine npm run migration:run
```

Requires `uuid-ossp` extension in `mm_chat` before first migration.

### Entity Relationships

```
Conversation 1 ──< * Message
```

---

## SpringMate Integration

| Integration Point | Direction | Details |
|-------------------|-----------|---------|
| JWT issuance | SpringMate → Browser → Chat | `auth_token` cookie, shared `JWT_SECRET` |
| Session cache | SpringMate → Redis → Chat | `auth:session:{sessionId}` JSON with `userUuid` |
| Session fallback | Chat → SpringMate | `POST /internal/v1/auth/resolve_session` with `X-SERVICE-KEY` |
| User lookup | Not integrated | Chat stores UUIDs only; no user profile/name resolution |
| Listing context | Not integrated | Conversations are user-pair based, not listing-scoped |

`shared/spring-api.urls.ts` defines URL constants aligned with SpringMate's `Urls.java` but **AuthService constructs URLs from env vars directly**, not from these constants.

### Frontend Integration (MarketMate)

The MarketMate Angular app (`MM/apps/marketmate`) connects via `socket.io-client` with `withCredentials: true` to `environment.chatServerUrl`.

| User flow | Socket events / components |
|-----------|---------------------------|
| App connect (authenticated) | `ChatSocketService.connect()` from `AppComponent` |
| Open `/chat` | `list_conversations` → sidebar populated |
| Select conversation | `join_conversation_by_id` → `get_messages` → thread rendered |
| Contact seller / profile chat | `/chat?userId={uuid}` → `join_conversation` |
| Send message | Optimistic UI → `send_message` → `new_message` |
| Realtime while connected | `ChatRealtimeBridgeService` handles `new_message`, `conversation_updated` |

Refresh behavior: conversation list and message history reload from PostgreSQL via socket events — not from in-memory state alone.

The chat service stores participant UUIDs only; display names in the sidebar default to placeholders unless enriched by the frontend via SpringMate user APIs.

---

## Runtime Configuration

Environment file: `src/env/.env` (loaded via `ConfigModule` with `envFilePath: 'src/env/.env'`)

All variables below are validated at startup by Joi (`src/config/env.validation.ts`). Missing required values or unresolved `.or()` constraints cause the application to **fail fast** before accepting connections. `validationOptions.abortEarly: false` reports all validation errors in one response.

### Variable Reference

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |
| `PORT` | No | `3000` | HTTP(S) listen port (`main.ts` reads via `ConfigService`) |
| `ALLOWED_APP_ORIGINS` | No | Local dev origins\* | Comma-separated CORS and Socket.IO origins |
| `JWT_SECRET` | **Yes** | — | JWT verification secret; must match SpringMate |
| `AUTH_RESOLVE_URL` | **Yes\*\*** | — | Full URL to SpringMate `POST /internal/v1/auth/resolve_session` |
| `SPRING_BASE_URL` | **Yes\*\*** | — | Legacy alias for `AUTH_RESOLVE_URL` (prefer `AUTH_RESOLVE_URL`) |
| `SPRING_INTERNAL_SERVICE_KEY` | **Yes** | — | Internal service key; must match SpringMate `SERVICE_KEY` / `app.internal.service.key` |
| `REDIS_HOST` | **Yes** | — | Redis host for session cache reads |
| `REDIS_PORT` | No | `6379` | Redis port |
| `REDIS_PASSWORD` | No | — | Redis password (empty allowed) |
| `DB_HOST` | **Yes** | — | PostgreSQL host |
| `DB_PORT` | **Yes** | — | PostgreSQL port |
| `DB_USER` | **Yes** | — | PostgreSQL user |
| `DB_PASSWORD` | **Yes** | — | PostgreSQL password |
| `DB_NAME` | **Yes** | — | Database name (`mm_chat`) |
| `NODE_TLS_REJECT_UNAUTHORIZED` | No | — | `0` or `1`; local dev only for self-signed SpringMate certs |

\*Default `ALLOWED_APP_ORIGINS`: `https://marketmate.local:4200`, `https://admin.marketmate.local:4300`, `http://localhost:4200`, `http://localhost:4300` (exported as `DEFAULT_ALLOWED_APP_ORIGINS` in `env.validation.ts`).

\*\*At least one of `AUTH_RESOLVE_URL` or `SPRING_BASE_URL` must be set. `SPRING_INTERNAL_SERVICE_KEY` is always required — there is no legacy alias and no hardcoded fallback.

### Canonical vs Legacy Variables

| Preferred | Legacy alias | Resolution in `AuthService` |
|-----------|--------------|-------------------------------|
| `AUTH_RESOLVE_URL` | `SPRING_BASE_URL` | `ConfigService.get('AUTH_RESOLVE_URL')` → `getOrThrow('SPRING_BASE_URL')` |
| `SPRING_INTERNAL_SERVICE_KEY` | *(none)* | `ConfigService.getOrThrow('SPRING_INTERNAL_SERVICE_KEY')` |

The internal service key is validated at startup by Joi and read exclusively via `getOrThrow`. A missing or empty value prevents the application from booting.

### TLS Certificates

`main.ts` reads:

- `/certs/wildcard.marketmate.local-key.pem`
- `/certs/wildcard.marketmate.local.pem`

Mounted read-only in Docker from `mm-chat-service/certs/`.

### Docker Compose (mm-infra)

Service name: `chat-engine`, container: `chat-engine`

- Host port `4400` → container port `3000`
- Env file: `mm-chat-service/src/env/.env`
- Depends on shared `postgres` and `redis` services

---

## Security Architecture

### Strengths

- JWT in httpOnly cookie — not exposed to JavaScript
- Session invalidation works via SpringMate (JWT subject is sessionId)
- `join_conversation_by_id` verifies participant membership via `ConversationService.isParticipant`
- `send_message` verifies participant membership before persist and emit
- Internal Spring endpoint protected by service key
- CORS restricted to configured origins with credentials
- HTTPS enforced at bootstrap
- Fail-fast Joi validation for security-critical environment variables at startup

### Weaknesses / Gaps

| Issue | Severity | Details |
|-------|----------|---------|
| Duplicate auth logic | Medium | Handshake middleware + `WsJwtGuard` overlap |
| Inconsistent error handling in gateway | Low | Auth-related handlers return structured `{ success: false, error }`; other failures may still throw |
| No rate limiting | Medium | No per-user or per-event throttling |
| No input validation | Medium | No DTOs, class-validator, or content length limits |
| `NODE_TLS_REJECT_UNAUTHORIZED=0` | Medium (dev) | Disables TLS verification for Spring fallback calls |

---

## Performance Considerations

### Current Design

- **Personal + conversation dual emit**: Ensures delivery when receiver is online but not in the conversation room. May cause duplicate `new_message` events if the receiver is in both rooms.
- **Synchronous DB write before emit**: Message is persisted before broadcast; delivery latency includes DB round-trip.
- **No connection pooling config**: TypeORM defaults apply.
- **Redis lazy connect**: First Redis operation triggers connection; no explicit health check at startup.
- **No horizontal scaling adapter**: Socket.IO room state is in-process (single-instance local/dev setup).

---

## Architecture Highlights

Portfolio-relevant design choices in this service:

- **Socket-first microservice** — realtime chat isolated from the Spring Boot REST API, with its own PostgreSQL database (`mm_chat`)
- **Shared auth without token duplication** — reuses SpringMate JWT cookies and Redis `auth:session:*` cache; chat service never issues its own tokens
- **Cache-first session resolution** — Redis lookup before internal HTTP fallback to SpringMate
- **Persistent 1:1 messaging** — messages and conversations stored in PostgreSQL; history and sidebar bootstrap over WebSocket (`get_messages`, `list_conversations`)
- **Participant authorization** — membership verified before send and history fetch via shared `ConversationService.isParticipant`
- **Fail-fast configuration** — Joi validates security-critical env vars at startup (JWT secret, service key, DB, Redis)
- **Migration-driven schema** — `synchronize: false`; explicit TypeORM migrations for production-safe DDL
- **End-to-end Angular integration** — MarketMate client uses acknowledgement-based Socket.IO patterns aligned with backend event contracts

---

## WebSocket Event Reference

| Direction | Event | Payload | Response / Emit |
|-----------|-------|---------|-----------------|
| Client → Server | `join_conversation` | `{ otherUserUuid }` | `{ conversationId }` |
| Client → Server | `join_conversation_by_id` | `{ conversationId }` | `{ conversationId, success: true }` or `{ success: false, error: { code, message } }` |
| Client → Server | `list_conversations` | `{}` | `{ success, conversations }` or `{ success: false, error: { code, message } }` |
| Client → Server | `get_messages` | `{ conversationId, limit?, offset? }` | `{ success, messages }` or `{ success: false, error: { code, message } }` |
| Client → Server | `send_message` | `{ conversationId, content }` | `{ success, message }` or `{ success: false, error: { code, message } }` |
| Server → Client | `new_message` | `{ id, conversationId, senderUuid, content, createdAt }` | — |
| Server → Client | `conversation_updated` | `{ conversationId, lastMessage, senderUuid }` | — |
| Server → Client | `auth_error` | `'Unauthorized'` | On guard failure |

---

## Related Documentation

- **System Architecture**: `mm-infra/docs/ARCHITECTURE.md` — C4 diagrams, Docker topology, chat auth flow
- **Backend Architecture**: `SpringMate/SpringMate/docs/ARCHITECTURE.md` — JWT, sessions, Redis auth cache
- **Frontend Architecture**: `MM/docs/ARCHITECTURE.md` — Angular monorepo; chat UI in `apps/marketmate`
- **Chat planning**: `MM/docs/CHAT_LIST_CONVERSATIONS_PLAN.md` — conversation list design notes
- **Service README**: `mm-chat-service/README.md` — WebSocket API quick reference
