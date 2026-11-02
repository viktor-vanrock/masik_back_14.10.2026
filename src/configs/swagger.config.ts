import { DocumentBuilder } from '@nestjs/swagger';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';

export const swaggerConfig = new DocumentBuilder()
  .setTitle('Benchmark Catalog API')
  .setDescription(
    [
      'Benchmark Catalog API.',
      '',
      'Domain terms:',
      '- **Benchmark** — suite / category (parent entity).',
      '- **BenchmarkTest** — card inside a suite (the frontend `BenchmarkType`).',
      '',
      'Main endpoints groups:',
      '- `catalog` — grouped catalog read-model for the main UI page.',
      '- `benchmarks` — Benchmark (suite) CRUD.',
      '- `benchmark-tests` — flat BenchmarkTest CRUD + list with filters.',
      '',
      'Auth: protected routes are authenticated via an HttpOnly `access_token` cookie set by ' +
      '`POST /auth/login`/`POST /auth/register` — there is no Bearer token transport. Swagger UI ' +
      'cannot exercise HttpOnly cookies interactively; use a real browser session or `curl --cookie`.',
    ].join('\n')
  )
  .setVersion('1.0')
  .addCookieAuth(
    AUTH_COOKIE_NAME,
    {
      type: 'apiKey',
      in: 'cookie',
      description: 'HttpOnly access token cookie, set by POST /auth/login or POST /auth/register',
    },
    AUTH_COOKIE_NAME
  )
  .addApiKey(
    {
      type: 'apiKey',
      name: 'x-api-key',
      in: 'header',
      description: 'External API key for external services',
    },
    'x-api-key'
  )
  .addTag('catalog', 'Grouped catalog read-model (main UI page)')
  .addTag('benchmarks', 'Benchmark suite CRUD')
  .addTag('benchmark-tests', 'BenchmarkTest CRUD + filters')
  .addTag('external-metrics', 'External metric definition API')
  .addTag('external-models', 'External model registry API')
  .addTag('external-metric-results', 'External metric result ingestion API')
  .build();
