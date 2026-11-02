import { Role } from '../enums/role.enum';
import type { Request as RequestExpress } from 'express';

// Request with typed User
// WARN: Only for protected routes
export type Request = RequestExpress & { user: RequestUser };

export type RequestUser = {
  id: string;
  username: string;
  role: Role;
};
