import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import type { RequestUser } from '@/common/types/request.type';
import type { Request, Response } from 'express';

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;

@Injectable()
export class ContactRequestsRateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private lastPruneAt = Date.now();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user: RequestUser }>();
    const response = context.switchToHttp().getResponse<Response>();
    const now = Date.now();
    if (now - this.lastPruneAt >= WINDOW_MS) {
      for (const [id, expired] of this.windows) {
        if (expired.resetAt <= now) this.windows.delete(id);
      }
      this.lastPruneAt = now;
    }
    const ownerId = request.user.id;
    let window = this.windows.get(ownerId);

    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + WINDOW_MS };
      this.windows.set(ownerId, window);
    }

    if (window.count >= MAX_REQUESTS) {
      response.setHeader('Retry-After', Math.ceil((window.resetAt - now) / 1000));
      throw new HttpException('Too many contact requests', 429);
    }

    window.count += 1;
    return true;
  }
}
