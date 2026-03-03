# MMChatService

MMChatService is a **real-time chat engine** built for the **MarketMate** platform. It is designed as a **separate
backend service** focused purely on real-time messaging, scalability, and clean separation of concerns.

The service uses **NestJS + Socket.IO**, integrates with **Spring Boot authentication**, and relies on **Redis and
PostgreSQL** for performance and persistence.

---

## 🧠 Why a Separate Chat Service?

* Real-time workloads behave very differently from REST APIs
* WebSockets require long-lived connections
* Easier horizontal scaling
* Cleaner architecture (auth, chat, core backend separated)

MMChatService is **not a REST API**. It is a **socket-first service**.

---

## 🧱 Tech Stack

* **Node.js** 22
* **NestJS** (WebSocket Gateway)
* **Socket.IO** (real-time communication)
* **PostgreSQL** (chat persistence)
* **Redis** (session validation + caching)
* **Docker / Docker Compose** (local & prod setup)

---

## 🔐 Authentication Model

Authentication is **delegated to the Spring Boot backend**.

### High-level flow

1. User logs in via Spring Boot
2. Spring Boot:

    * Creates a session
    * Stores session + user info in Redis
    * Issues a JWT (httpOnly cookie) containing `sessionId`
3. Browser connects to MMChatService via Socket.IO
4. MMChatService:

    * Reads JWT from httpOnly cookie
    * Verifies JWT signature
    * Extracts `sessionId`
    * Checks Redis for session existence
    * Reads `userUuid` from Redis (cache-first)
    * Falls back to Spring Boot only on cache miss

> Redis is treated as a **cache**, Spring Boot remains the **source of truth**.

---

## 🔌 WebSocket API

### Connect

* Uses httpOnly cookie automatically
* No token handling in frontend

```ts
io(CHAT_WS_URL, {
  withCredentials: true
});
```

---

### Join Conversation

**Event**: `join_conversation`

```json
{
  "otherUserUuid": "uuid"
}
```

**Response**:

```json
{
  "conversationId": "uuid"
}
```

---

### Send Message

**Event**: `send_message`

```json
{
  "conversationId": "uuid",
  "content": "Hello"
}
```

---

### Receive Message

**Event**: `new_message`

```json
{
  "id": "uuid",
  "conversationId": "uuid",
  "senderUuid": "uuid",
  "content": "Hello",
  "createdAt": "timestamp"
}
```

---

## ⚙️ Configuration

| Variable | Description | Default (in code) |
|----------|-------------|-------------------|
| `PORT` | HTTP(S) server port | `4400` |
| `ALLOWED_APP_ORIGINS` | Comma-separated CORS origins for Socket.IO / HTTP | `https://marketmate.local:4200`, `https://admin.marketmate.local:4300`, `http://localhost:4200`, `http://localhost:4300` |

The service runs over **HTTPS**. Certificate paths are set in code (`/certs/`). For local development, see `certs/README.md`.

---

## 🐳 Docker (Local Development)

### Dockerfile

* Node 22 (slim)
* Hot reload
* Volume-mounted source

### docker-compose service

```yaml
chat-engine:
  build:
    context: ./mm-chat-service
    dockerfile: DOCKERFILE.local
  ports:
    - "3100:3000"
  volumes:
    - ./mm-chat-service:/app
    - chat_engine_node_modules:/app/node_modules
  environment:
    - NODE_ENV=development
```

---

## 🚀 Design Principles

* Socket-first (no REST controllers)
* Stateless chat engine
* Redis-first, backend-authoritative auth
* Strong separation of concerns
* Docker-native
* Production-ready logging