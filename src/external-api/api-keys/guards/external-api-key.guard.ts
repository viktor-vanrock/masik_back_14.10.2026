import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ExternalApiKeysService } from '@/external-api/api-keys/external-api-keys.service';
import { EXTERNAL_API_KEY_SCOPES_KEY } from '../external-api-key.constants';
import { ValidatedExternalApiKey } from '../types/validated-external-api-key.type';

type ExternalApiRequest = Request & {
  externalApiKey?: ValidatedExternalApiKey;
};

@Injectable()
export class ExternalApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeysService: ExternalApiKeysService,
    private readonly reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<ExternalApiRequest>();
    const apiKey = this.extractApiKey(request);

    if (!apiKey) {
      throw new UnauthorizedException('External API key is required');
    }

    const requiredScopes = this.reflector.getAllAndOverride<string[]>(
      EXTERNAL_API_KEY_SCOPES_KEY,
      [context.getHandler(), context.getClass()]
    ) ?? [];

    request.externalApiKey = await this.apiKeysService.validateApiKey(
      apiKey,
      requiredScopes
    );

    return true;
  }

  private extractApiKey(request: Request): string | undefined {
    const xApiKey = request.headers['x-api-key'];
    const normalizedXApiKey = Array.isArray(xApiKey)
      ? xApiKey[0]
      : xApiKey;

    if (normalizedXApiKey?.trim()) {
      return normalizedXApiKey.trim();
    }

    const authorization = request.headers.authorization;
    const match = /^(?:Bearer|ApiKey)\s+(.+)$/i.exec(
      authorization?.trim() ?? ''
    );

    return match?.[1]?.trim();
  }
}
