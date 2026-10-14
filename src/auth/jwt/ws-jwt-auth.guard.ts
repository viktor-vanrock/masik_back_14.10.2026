import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { parse as parseCookie } from 'cookie';
import { Socket } from 'socket.io';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import { RequestUser } from '@/common/types/request.type';
import { JwtPayload } from '../types';

/**
 * Guard для WebSocket-гейтвеев.
 *
 * Первичная аутентификация происходит в `ConversationsGateway.handleConnection`
 *
 * Токен читается только из HttpOnly cookie в `client.handshake.headers.cookie` — Bearer
 * через `auth.token`/`headers.authorization`/`query.token` больше не поддерживается.
 */
@Injectable()
export class WsJwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtAuthGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<Socket>();

    if (client.data?.user) {
      return true;
    }

    const user = this.authenticate(client);
    if (!user) {
      throw new WsException('Unauthorized: missing or invalid access token');
    }

    client.data = { ...client.data, user };

    return true;
  }

  authenticate(client: Socket): Nullable<RequestUser> {
    const token = this.extractToken(client);
    if (!token) {
      this.logger.warn(`WS auth failed: missing access token (socket=${client.id})`);
      return null;
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>('jwtAccessSecret'),
      });

      return {
        id: payload.sub,
        username: payload.username,
        role: payload.role,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`WS auth failed: invalid access token: ${message} (socket=${client.id})`);
      return null;
    }
  }

  private extractToken(client: Socket): Nullable<string> {
    const raw = client.handshake.headers.cookie;
    if (!raw) {
      return null;
    }

    return parseCookie(raw)[AUTH_COOKIE_NAME] ?? null;
  }
}
