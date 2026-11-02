import { ConfigService } from '@nestjs/config';
import ms, { StringValue } from 'ms';
import type { CookieOptions } from 'express';

export const AUTH_COOKIE_NAME = 'access_token';

export const getAuthCookieScopeOptions = (configService: ConfigService): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: 'dev' !== configService.getOrThrow<string>('nodeEnv'),
});

export const getAuthCookieSetOptions = (configService: ConfigService): CookieOptions => ({
  ...getAuthCookieScopeOptions(configService),
  maxAge: ms(configService.getOrThrow<StringValue>('jwtAccessExpire')),
});
