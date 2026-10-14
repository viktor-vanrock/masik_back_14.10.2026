import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request, RequestUser } from '../types/request.type';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return req.user;
  }
);
