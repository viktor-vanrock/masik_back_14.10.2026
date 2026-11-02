import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class InterviewerServiceTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('agent.apiKey') ?? '';
    const header = context.switchToHttp().getRequest<Request>().headers.authorization;
    const supplied = /^Bearer ([^\s]+)$/.exec(header ?? '')?.[1] ?? '';
    const valid = expected.length > 0 && supplied.length > 0 && timingSafeEqual(
      createHash('sha256').update(expected).digest(),
      createHash('sha256').update(supplied).digest()
    );
    if (!valid) throw new UnauthorizedException('Invalid service token');
    return true;
  }
}
