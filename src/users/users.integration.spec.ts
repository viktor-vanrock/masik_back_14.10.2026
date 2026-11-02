import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { compare } from 'bcrypt';
import { Pool } from 'pg';
import { Socket } from 'socket.io';
import request from 'supertest';
import { AuthController } from '@/auth/auth.controller';
import { AuthService } from '@/auth/auth.service';
import { JwtAuthGuard } from '@/auth/jwt/jwt-auth.guard';
import { JwtStrategy } from '@/auth/jwt/jwt.strategy';
import { WsJwtAuthGuard } from '@/auth/jwt/ws-jwt-auth.guard';
import { LocalStrategy } from '@/auth/local/local.strategy';
import { Role } from '@/common/enums/role.enum';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Prisma, PrismaClient } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { UsersRepository } from './repositories/users.repository';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('User conflict responses with PostgreSQL constraints', () => {
  let app: NestExpressApplication;
  let db: PGlite;
  let pool: Pool;
  let prisma: PrismaClient;
  let repository: UsersRepository;
  let users: UsersService;
  let jwt: JwtService;
  let superCookie: string;
  const first = { username: 'first', email: 'first@example.test', password: 'BenchFactory2026!' };
  const second = { ...first, username: 'second', email: 'second@example.test' };
  const conflict = (field: 'email' | 'username') => ({
    statusCode: 409,
    code: 'email' === field ? 'EMAIL_ALREADY_EXISTS' : 'USERNAME_ALREADY_EXISTS',
    message: 'email' === field
      ? 'Пользователь с таким email уже зарегистрирован.'
      : 'Это имя пользователя уже занято.',
    field,
  });

  beforeAll(async () => {
    db = new PGlite();
    const migration = readFileSync(resolve('prisma/migrations/20260529112400_init/migration.sql'), 'utf8');
    for (const statement of migration.split(';')) {
      if (/CREATE TYPE "Role"|CREATE TABLE "users"|CREATE UNIQUE INDEX "users_(username|email)_key"/.test(statement)) {
        await db.exec(`${statement};`);
      }
    }
    await db.exec(readFileSync(resolve('prisma/migrations/20261101010000_add_demo_role/migration.sql'), 'utf8'));
    pool = new Pool();
    // Run the real Prisma PostgreSQL adapter against an isolated in-memory database.
    pool.query = (async (query: { text: string }, values: unknown[]) => {
      const result = await db.query<Record<string, unknown>>(query.text, values);
      return {
        fields: result.fields,
        rows: result.rows.map((row) => result.fields.map((field) => {
          const value = row[field.name];
          return value instanceof Date ? value.toISOString() : value;
        })),
        rowCount: result.affectedRows,
      };
    }) as Pool['query'];
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    repository = new UsersRepository(prisma as PrismaService);
    users = new UsersService(repository);
    const settings: Record<string, string> = {
      nodeEnv: 'dev', jwtAccessSecret: 'test-only-signing-key', jwtAccessExpire: '1h',
    };
    jwt = new JwtService({ secret: settings.jwtAccessSecret });
    superCookie = cookie(Role.SuperUser);
    const module = await Test.createTestingModule({
      controllers: [AuthController, UsersController],
      providers: [AuthService, JwtStrategy, LocalStrategy,
        { provide: UsersService, useValue: users },
        { provide: ConfigService, useValue: { getOrThrow: (key: string) => settings[key] } },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    const reflector = new Reflector();
    app.useGlobalGuards(new JwtAuthGuard(reflector), new RolesGuard(reflector));
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await pool?.end();
    await db?.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await prisma.user.deleteMany();
  });

  it('registers a unique user, hashes the password and sets the session cookie', async () => {
    const response = await request(app.getHttpServer()).post('/auth/register').send(first)
      .expect(201, { success: true });
    expect(response.headers['set-cookie'][0]).toMatch(/access_token=.+;.*HttpOnly/);
    const saved = await prisma.user.findUniqueOrThrow({ where: { username: first.username } });
    expect(await compare(first.password, saved.password)).toBe(true);
    expect(saved.role).toBe('USER');
    expect(await users.findUserById(saved.id)).not.toHaveProperty('password');
  });

  it.each(['email', 'username'] as const)('returns a safe 409 for duplicate %s without creating a user', async (field) => {
    await users.createUser(first);
    const response = await request(app.getHttpServer()).post('/auth/register')
      .send({ ...second, [field]: first[field] }).expect(409, conflict(field));
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await prisma.user.count()).toBe(1);
  });

  it.each(['email', 'username'] as const)('handles simultaneous registrations with the same %s', async (field) => {
    // Both requests pass the optional username precheck before either writes.
    jest.spyOn(repository, 'findUserByUsername').mockResolvedValue(null);
    const responses = await Promise.all([
      request(app.getHttpServer()).post('/auth/register').send(first),
      request(app.getHttpServer()).post('/auth/register').send({ ...second, [field]: first[field] }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(responses.find((response) => 409 === response.status)?.body).toEqual(conflict(field));
    expect(await prisma.user.count()).toBe(1);
  });

  it.each(['email', 'username'] as const)('rejects an update to a conflicting %s and preserves the user', async (field) => {
    await users.createUser(first);
    const original = await users.createUser(second);
    jest.spyOn(repository, 'findUserByUsername').mockResolvedValue(null);
    await request(app.getHttpServer()).patch(`/users/${original.id}`)
      .set('Cookie', superCookie)
      .send({ [field]: first[field] }).expect(409, conflict(field));
    expect(await users.findUserById(original.id)).toEqual(original);
  });

  it('returns the same contract for an existing username detected before update', async () => {
    await users.createUser(first);
    const original = await users.createUser(second);
    await request(app.getHttpServer()).patch(`/users/${original.id}`)
      .set('Cookie', superCookie)
      .send({ username: first.username }).expect(409, conflict('username'));
  });

  it('supports Prisma unique errors exposing the target directly', async () => {
    jest.spyOn(repository, 'createNewUser').mockRejectedValue(new Prisma.PrismaClientKnownRequestError('unique constraint', {
      code: 'P2002', clientVersion: 'test', meta: { target: ['email'] },
    }));
    await expect(users.createUser(first)).rejects.toMatchObject({ response: conflict('email') });
  });

  it.each([Role.Demo, Role.Admin, Role.SuperUser])('cannot self-grant %s on public registration', async (role) => {
    const response = await request(app.getHttpServer()).post('/auth/register')
      .send({ ...first, role }).expect(201);
    const saved = await prisma.user.findUniqueOrThrow({ where: { username: first.username } });
    expect(saved.role).toBe(Role.User);
    const token = response.headers['set-cookie'][0].split(';')[0].split('=')[1];
    expect(jwt.verify(token).role).toBe(Role.User);
  });

  it('keeps registration unprivileged even if a caller bypasses the public DTO', async () => {
    const maliciousInput = { ...first, role: Role.SuperUser };
    const token = await app.get(AuthService).register(maliciousInput);
    expect(jwt.verify(token).role).toBe(Role.User);
    expect((await prisma.user.findUniqueOrThrow({ where: { username: first.username } })).role).toBe(Role.User);
  });

  it('lets SUPERUSER create and assign DEMO, then preserves it through login and profile reads', async () => {
    const created = await request(app.getHttpServer()).post('/users')
      .set('Cookie', superCookie).send({ ...first, role: Role.Demo }).expect(201);
    expect(created.body.role).toBe(Role.Demo);
    expect(created.body).not.toHaveProperty('password');
    const regular = await users.createUser(second);
    await request(app.getHttpServer()).patch(`/users/${regular.id}`).set('Cookie', superCookie)
      .send({ role: Role.Demo }).expect(200).expect(({ body }) => expect(body.role).toBe(Role.Demo));
    const login = await request(app.getHttpServer()).post('/auth/login')
      .send({ username: second.username, password: second.password }).expect(200);
    const sessionCookie = login.headers['set-cookie'][0].split(';')[0];
    expect(jwt.verify(sessionCookie.split('=')[1])).toMatchObject({ sub: regular.id, role: Role.Demo });
    const wsGuard = new WsJwtAuthGuard(jwt, app.get(ConfigService));
    expect(wsGuard.authenticate({ handshake: { headers: { cookie: sessionCookie } } } as Socket))
      .toMatchObject({ id: regular.id, role: Role.Demo });
    for (let reload = 0; reload < 2; reload += 1) {
      await request(app.getHttpServer()).get('/users/profile').set('Cookie', sessionCookie)
        .expect(200).expect(({ body }) => {
          expect(body).toMatchObject({ id: regular.id, role: Role.Demo });
          expect(body).not.toHaveProperty('password');
        });
    }
  });

  it.each([Role.User, Role.Demo, Role.Admin])('keeps user administration forbidden for %s', async (role) => {
    const target = await users.createUser(first);
    const ownCookie = cookie(role, target.id);
    await request(app.getHttpServer()).get('/users').set('Cookie', ownCookie).expect(403);
    await request(app.getHttpServer()).get(`/users/${target.id}`).set('Cookie', ownCookie).expect(403);
    await request(app.getHttpServer()).post('/users').set('Cookie', ownCookie)
      .send({ ...second, role: Role.Demo }).expect(403);
    await request(app.getHttpServer()).patch(`/users/${target.id}`).set('Cookie', ownCookie)
      .send({ role: Role.SuperUser }).expect(403);
    await request(app.getHttpServer()).delete(`/users/${target.id}`).set('Cookie', ownCookie).expect(403);
    expect((await users.findUserById(target.id)).role).toBe(Role.User);
    expect(await prisma.user.count()).toBe(1);
  });

  it('rejects invalid administrative roles without changing the user', async () => {
    const target = await users.createUser(first);
    await request(app.getHttpServer()).patch(`/users/${target.id}`).set('Cookie', superCookie)
      .send({ role: 'UNKNOWN' }).expect(400);
    expect((await users.findUserById(target.id)).role).toBe(Role.User);
  });

  it.each([Role.User, Role.Admin, Role.SuperUser])('preserves existing %s role through storage and login', async (role) => {
    const existing = await users.createUser({ ...first, role });
    const response = await request(app.getHttpServer()).post('/auth/login')
      .send({ username: first.username, password: first.password }).expect(200);
    const token = response.headers['set-cookie'][0].split(';')[0].split('=')[1];
    expect(jwt.verify(token)).toMatchObject({ sub: existing.id, role });
    expect((await users.findUserById(existing.id)).role).toBe(role);
  });

  it.each([
    new Error('Database unavailable'),
    new Prisma.PrismaClientKnownRequestError('Missing record', { code: 'P2025', clientVersion: 'test' }),
    new Prisma.PrismaClientKnownRequestError('Other unique constraint', {
      code: 'P2002', clientVersion: 'test', meta: { target: ['id'] },
    }),
  ])('preserves unexpected storage errors: %s', async (error) => {
    jest.spyOn(repository, 'createNewUser').mockRejectedValue(error);
    jest.spyOn(repository, 'updateUserById').mockRejectedValue(error);
    jest.spyOn(repository, 'findUserById').mockResolvedValue({ id: 'existing', ...second } as never);
    await expect(users.createUser(first)).rejects.toBe(error);
    await expect(users.updateUserById('existing', { email: first.email })).rejects.toBe(error);
  });

  function cookie(role: Role, id = '00000000-0000-4000-8000-000000000000') {
    return `access_token=${jwt.sign({ sub: id, username: role, role })}`;
  }
});
