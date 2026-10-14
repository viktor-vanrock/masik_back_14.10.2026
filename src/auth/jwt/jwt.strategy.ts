import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { parse as parseCookie } from 'cookie';
import { Strategy } from 'passport-jwt';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import { RequestUser } from '@/common/types/request.type';
import { JwtPayload } from '../types';
import type { Request } from 'express';

const extractTokenFromCookie = (req: Request): Nullable<string> => {
  const raw = req.headers.cookie;
  if (!raw) {
    return null;
  }
  return parseCookie(raw)[AUTH_COOKIE_NAME] ?? null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: extractTokenFromCookie,
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('jwtAccessSecret'),
    });
  }

  validate(payload: JwtPayload): RequestUser {
    return {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
    };
  }
}
