// Standalone browser QA only: real auth code with a disposable in-memory PostgreSQL database.
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const repo = resolve(__dirname, '../..');
process.chdir(repo);
const use = createRequire(resolve(repo, 'package.json'));
use('ts-node').register({ transpileOnly: true });
use('tsconfig-paths/register');
use('./scripts/register.js');
use('reflect-metadata');

const { PGlite } = use('@electric-sql/pglite');
const { PrismaPg } = use('@prisma/adapter-pg');
const { Pool } = use('pg');
const { Test } = use('@nestjs/testing');
const { ConfigService } = use('@nestjs/config');
const { APP_GUARD } = use('@nestjs/core');
const { ValidationPipe } = use('@nestjs/common');
const { JwtService } = use('@nestjs/jwt');
const { PassportModule } = use('@nestjs/passport');
const { PrismaClient } = use('./src/generated/prisma/client.ts');
const { PrismaService } = use('./src/prisma/prisma.service.ts');
const { UsersRepository } = use('./src/users/repositories/users.repository.ts');
const { IUsersRepository } = use('./src/users/repositories/users.repository.interface.ts');
const { UsersService } = use('./src/users/users.service.ts');
const { UsersController } = use('./src/users/users.controller.ts');
const { AuthController } = use('./src/auth/auth.controller.ts');
const { AuthService } = use('./src/auth/auth.service.ts');
const { JwtStrategy } = use('./src/auth/jwt/jwt.strategy.ts');
const { JwtAuthGuard } = use('./src/auth/jwt/jwt-auth.guard.ts');
const { LocalStrategy } = use('./src/auth/local/local.strategy.ts');
const { OriginCsrfGuard } = use('./src/common/guards/origin-csrf.guard.ts');
const { RolesGuard } = use('./src/common/guards/roles.guard.ts');

(async () => {
  const port = Number(process.env.QA_AUTH_PORT || 3189);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid QA_AUTH_PORT');
  const db = new PGlite();
  const migration = readFileSync(resolve(repo, 'prisma/migrations/20260529112400_init/migration.sql'), 'utf8');
  for (const statement of migration.split(';')) {
    if (/CREATE TYPE "Role"|CREATE TABLE "users"|CREATE UNIQUE INDEX "users_(username|email)_key"/.test(statement)) {
      await db.exec(`${statement};`);
    }
  }

  const pool = new Pool();
  pool.query = async (query, values) => {
    const result = await db.query(typeof query === 'string' ? query : query.text, values);
    return {
      fields: result.fields,
      rows: result.rows.map(row => result.fields.map(field =>
        row[field.name] instanceof Date ? row[field.name].toISOString() : row[field.name])),
      rowCount: result.affectedRows,
    };
  };
  // Prisma's ordinary queries use pool.query above; never fall back to a shared database.
  pool.connect = async () => { throw Error('Interactive transactions are unavailable in the isolated auth QA server'); };
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const settings = {
    nodeEnv: 'dev', jwtAccessSecret: 'isolated-qa-only-signing-key', jwtAccessExpire: '1h',
    trustedOrigins: ['http://localhost:5178', 'http://127.0.0.1:5178'],
  };
  const config = {
    get: key => settings[key],
    getOrThrow: key => {
      if (!(key in settings)) throw Error('Missing QA setting: ' + key);
      return settings[key];
    },
  };
  const module = await Test.createTestingModule({
    imports: [PassportModule],
    controllers: [AuthController, UsersController],
    providers: [UsersService, AuthService, JwtStrategy, LocalStrategy,
      { provide: PrismaService, useValue: prisma },
      { provide: IUsersRepository, useClass: UsersRepository },
      { provide: ConfigService, useValue: config },
      { provide: JwtService, useValue: new JwtService() },
      { provide: APP_GUARD, useClass: OriginCsrfGuard },
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard }],
  }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api');
  app.enableCors({ origin: settings.trustedOrigins, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.getHttpAdapter().get('/__qa/users', async (_req, res, next) => {
    try {
      res.json(await prisma.user.findMany({ select: { id: true, username: true, email: true } }));
    } catch (error) { next(error); }
  });
  await module.get(UsersService).createUser({
    username: 'existing-user', email: 'existing@example.test', password: 'BenchFactory2026!',
  });
  await app.listen(port, '127.0.0.1');
  console.log(`QA_AUTH_READY http://127.0.0.1:${port} (real Nest auth + PrismaPg; disposable in-memory PostgreSQL)`);
  const close = async () => {
    await app.close();
    await prisma.$disconnect();
    await pool.end();
    await db.close();
    process.exit(0);
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
})().catch(error => { console.error(error); process.exit(1); });
