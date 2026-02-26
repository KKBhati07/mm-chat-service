import {
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.provider';
import { AppLogger } from '../../core/logger/app.logger';

@Injectable()
export class AuthService {
  private readonly SESSION_PREFIX = 'auth:session:';

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly logger: AppLogger,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.logger.setContext(AuthService.name);
  }

  /**
   * Verifies a JWT token and extracts the sessionId from its payload.
   *
   * @param token - Raw JWT token (usually from Authorization header)
   * @returns Object containing the resolved sessionId
   * @throws UnauthorizedException if token is invalid or sessionId is missing
   */
  verifyJwt(token: string): { sessionId: string } {
    try {
      const payload = this.jwtService.verify(token);
      const sessionId = payload?.sessionId ?? payload?.sub;
      if (!sessionId) {
        this.logger.warn('JWT verified but sessionId missing');
        throw new UnauthorizedException();
      }
      this.logger.debug('JWT verified successfully');
      return { sessionId };
    } catch {
      this.logger.warn('JWT verification failed');
      throw new UnauthorizedException('Invalid JWT');
    }
  }

  /**
   * Resolves the user UUID for a given sessionId.
   *
   * Resolution strategy:
   * 1. Try Redis cache (fast path)
   * 2. Fallback to Spring Auth service if cache miss or invalid data
   *
   * @param sessionId - Session identifier extracted from JWT
   * @returns User UUID associated with the session
   * @throws UnauthorizedException if session is invalid
   */
  async resolveUserUuid(sessionId: string): Promise<string> {
    const key = `${this.SESSION_PREFIX}${sessionId}`;

    const exists = await this.redis.exists(key);
    if (!exists) {
      this.logger.debug('Session not found in Redis, falling back to Spring');
      return this.resolveViaSpring(sessionId);
    }

    const raw = await this.redis.get(key);
    if (!raw) {
      this.logger.debug('Redis session value empty, falling back to Spring');
      return this.resolveViaSpring(sessionId);
    }

    try {
      const parsed = JSON.parse(raw);
      if (!parsed?.userUuid) {
        this.logger.debug(
          'userUuid missing in Redis payload, falling back to Spring',
        );
        return this.resolveViaSpring(sessionId);
      }
      this.logger.debug('Resolved userUuid from Redis cache');
      return parsed.userUuid;
    } catch {
      this.logger.warn(
        'Failed to parse Redis session payload, falling back to Spring',
      );
      return this.resolveViaSpring(sessionId);
    }
  }

  /**
   * Resolves session details via Spring Auth service internal endpoint.
   *
   * Used as a fallback when:
   * - Redis cache miss
   * - Corrupted cache entry
   * - Missing userUuid in cache
   *
   * Includes a timeout safeguard to prevent hanging requests.
   *
   * @param sessionId - Session identifier to resolve
   * @returns User UUID returned by Spring Auth service
   * @throws UnauthorizedException if session is invalid or service fails
   */
  private async resolveViaSpring(sessionId: string): Promise<string> {
    this.logger.debug(
      'Calling Spring Auth service internal endpoint to resolve session',
    );

    // Construct URL from Spring base URL + internal endpoint path
    const url =
      this.configService.get<string>('SPRING_BASE_URL') ||
      this.configService.get<string>('AUTH_RESOLVE_URL');

    if (!url){
      this.logger.error('Unable to Authenticate. Auth Url not found!');
      throw new InternalServerErrorException(
        'Unable to Authenticate. Auth Url not found!',
      );
    }

    // Get service key for internal endpoint authentication
    const serviceKey =
      this.configService.get<string>('SPRING_INTERNAL_SERVICE_KEY') ||
      this.configService.get<string>('INTERNAL_SERVICE_KEY') ||
      '6911aa62-3705-42ef-8484-db35b62cf9ba';

    if (!serviceKey) {
      this.logger.error('Internal service key not configured');
      throw new UnauthorizedException('Service configuration error');
    }

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10000);
    console.warn('Url =>', url);

    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-SERVICE-KEY': serviceKey,
        },
        body: JSON.stringify({ sessionId }),
      });

      if (!res.ok) {
        this.logger.warn('Spring Auth service rejected session');
        throw new UnauthorizedException();
      }

      const response = await res.json();

      if (!response?.data?.userUuid) {
        this.logger.warn('Spring response missing userUuid');
        throw new UnauthorizedException();
      }

      this.logger.log('Resolved userUuid via Spring fallback');
      return response.data.userUuid;
    } catch (err) {
      this.logger.error('Spring Auth fallback failed', err?.stack);
      throw new UnauthorizedException('Session invalid');
    }
  }
}
