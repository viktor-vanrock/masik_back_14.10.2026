import { ConfigService } from '@nestjs/config';

export const assertOriginConfig = (configService: ConfigService): void => {
  const nodeEnv = configService.getOrThrow<string>('nodeEnv');
  if ('dev' === nodeEnv) {
    return;
  }

  const trustedOrigins = configService.get<string[]>('trustedOrigins') ?? [];
  const trustForwardedHeaders = configService.get<boolean>('originTrustForwardedHeaders') ?? false;

  if (0 === trustedOrigins.length && !trustForwardedHeaders) {
    throw new Error(
      'Origin validation is not configured for a non-dev environment. ' +
      'Set TRUSTED_ORIGINS to an explicit comma-separated allowlist of origins (preferred), ' +
      'or set ORIGIN_TRUST_FORWARDED_HEADERS=true to reconstruct the origin from ' +
      'X-Forwarded-Host/X-Forwarded-Proto — enable the latter only when a trusted reverse ' +
      'proxy overwrites those headers and the backend is not directly reachable.'
    );
  }
};
