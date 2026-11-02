import { Role } from '@/common/enums/role.enum';
import type { RegisterDto } from '../dto/registerDto.dto';
import type { RequestUser } from '@/common/types/request.type';

export const AUTH_MOCK = {
  ids: {
    userId: '3f1a5df0-7c35-4a12-9b5e-2d5b3b4dca11',
  },

  success: {
    success: true,
  },

  // passport-local default body: username/password
  loginBody: {
    username: 'user1',
    password: 'Str0ngP@ssw0rd!',
    email: 'user@email.com',
  },

  registerBody: {
    username: 'user1',
    password: 'Str0ngP@ssw0rd!',
    email: 'user@email.com',
  } satisfies RegisterDto,

  requestUser: {
    id: '3f1a5df0-7c35-4a12-9b5e-2d5b3b4dca11',
    username: 'user1',
    role: Role.User,
  } satisfies RequestUser,
};
