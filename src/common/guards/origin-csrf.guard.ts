import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { CSRF_EXEMPT_KEY } from '@/common/decorators/csrf-exempt.decorator';
import { isAllowedOrigin } from '@/common/utils/origin.util';
import type { Request } from 'express';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEV_LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

@Injectable()
export class OriginCsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if ('http' !== context.getType()) {
      return true;
    }

    const isExempt = this.reflector.getAllAndOverride<boolean>(CSRF_EXEMPT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isExempt) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (!UNSAFE_METHODS.has(request.method)) {
      return true;
    }

    const nodeEnv = this.configService.getOrThrow<string>('nodeEnv');
    const candidate = request.headers.origin ?? request.headers.referer;

    if (this.isDevLoopbackException(candidate, nodeEnv)) {
      return true;
    }

    const ok = isAllowedOrigin(candidate, {
      headers: request.headers,
      encrypted: Boolean((request.socket as { encrypted?: boolean }).encrypted),
      nodeEnv,
      trustedOrigins: this.configService.get<string[]>('trustedOrigins') ?? [],
      originTrustForwardedHeaders:
        this.configService.get<boolean>('originTrustForwardedHeaders') ?? false,
    });

    if (!ok) {
      throw new ForbiddenException('Origin not allowed');
    }

    return true;
  }

  private isDevLoopbackException(candidate: string | undefined, nodeEnv: string): boolean {
    if ('dev' !== nodeEnv || !candidate) {
      return false;
    }

    try {
      const url = new URL(candidate);
      return 'http:' === url.protocol && DEV_LOOPBACK_HOSTNAMES.has(url.hostname);
    } catch {
      return false;
    }
  }
}
