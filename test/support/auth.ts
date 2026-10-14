import { JwtService } from '@nestjs/jwt';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import { Role } from '@/common/enums/role.enum';
import { PrismaService } from '@/prisma/prisma.service';
import type { INestApplication } from '@nestjs/common';

export const E2E_ORIGIN = 'http://127.0.0.1';

const E2E_USER_IDS: Record<Role, string> = {
  [Role.User]: '00000000-0000-4000-8000-000000000001',
  [Role.Admin]: '00000000-0000-4000-8000-000000000002',
  [Role.SuperUser]: '00000000-0000-4000-8000-000000000003',
};

export async function createAuthCookie(app: INestApplication, role: Role): Promise<string> {
  const id = E2E_USER_IDS[role];
  const identity = role.toLowerCase();
  await app.get(PrismaService).user.upsert({
    where: { id },
    create: {
      id,
      username: `e2e-${identity}`,
      email: `e2e-${identity}@example.test`,
      password: 'not-used-by-e2e-tests',
      role,
    },
    update: { role },
  });

  const token = await app.get(JwtService).signAsync({
    sub: id,
    username: `e2e-${identity}`,
    role,
  });

  return `${AUTH_COOKIE_NAME}=${token}`;
}
