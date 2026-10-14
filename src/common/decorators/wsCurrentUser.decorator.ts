import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Socket } from 'socket.io';
import { RequestUser } from '../types/request.type';

/**
 * Достаёт юзера, положенного `WsJwtAuthGuard` в `client.data.user`.
 * Использовать в @SubscribeMessage-методах WebSocket-гейтвеев.
 *
 * WARN: только для защищённых WS-эндпоинтов под `@UseGuards(WsJwtAuthGuard)`.
 */
export const WsCurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const client = ctx.switchToWs().getClient<Socket>();
    return client.data.user as RequestUser;
  }
);
