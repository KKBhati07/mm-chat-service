import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Socket } from 'socket.io';
import { AuthService } from '../services/auth.service';
import { getCookieValue } from '../cookie.util';
import { ContextService } from '../../core/context/context.service';
import { APP_CONSTANTS } from '../../shared/app.constants';
import { randomUUID } from 'crypto';
import { AppLogger } from '../../core/logger/app.logger';

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly contextService: ContextService,
    private readonly logger: AppLogger,
  ) {
    this.logger.setContext(WsJwtGuard.name)
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: Socket = context.switchToWs().getClient();

    return new Promise<boolean>(async (resolve, reject) => {
      this.contextService.run(async () => {
        try {
          // Basic WS context
          this.contextService.set(
            APP_CONSTANTS.REQUEST_CONTEXT.SOCKET_ID,
            client?.id ?? randomUUID(),
          );
          this.contextService.set('transport', APP_CONSTANTS.TRANSPORT.WEBSOCKET );

          // If handshake middleware already authenticated this socket, trust it.
          if (client.data?.sessionId && client.data?.userUuid) {
            this.contextService.set(
              APP_CONSTANTS.REQUEST_CONTEXT.SESSION_ID,
              client.data.sessionId,
            );
            this.contextService.set(
              APP_CONSTANTS.REQUEST_CONTEXT.USER_UUID,
              client.data.userUuid,
            );
            resolve(true);
            return;
          }

          this.logger.debug('Starting socket authentication (guard)');

          // Auth flow
          const cookieHeader = client.handshake.headers.cookie;
          const token = getCookieValue(cookieHeader, 'auth_token');

          if (!token) {
            this.logger.warn('Missing auth cookie');
            throw new UnauthorizedException();
          }

          const { sessionId } = this.authService.verifyJwt(token);
          const userUuid = await this.authService.resolveUserUuid(sessionId);

          // Attach identity
          client.data.sessionId = sessionId;
          client.data.userUuid = userUuid;

          this.contextService.set(APP_CONSTANTS.REQUEST_CONTEXT.SESSION_ID, sessionId);
          this.contextService.set(APP_CONSTANTS.REQUEST_CONTEXT.USER_UUID, userUuid);

          this.logger.log('Socket authenticated successfully');

          resolve(true);
        } catch (err) {
          this.logger.warn('Socket authentication failed');
          client.emit('auth_error', 'Unauthorized');
          client.disconnect();
          resolve(false);
        }
      });
    });
  }
}

