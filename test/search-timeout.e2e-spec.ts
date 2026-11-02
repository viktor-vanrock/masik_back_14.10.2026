import { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { BenchmarkSearchRepository } from '@/catalog/search/benchmark-search.repository';
import { executeSearchQuery, SEARCH_SQL_TIMEOUT_MS } from '@/catalog/search/search-query.executor';
import { Prisma, PrismaClient } from '@/generated/prisma/client';
import { DATABASE_CONNECTION_TIMEOUT_MS } from '@/prisma/prisma.service';
import { createE2eApplication } from './support/create-e2e-application';

describe('Search SQL deadlines (PostgreSQL e2e)', () => {
  let app: INestApplication;
  let repository: BenchmarkSearchRepository;
  let blocker: Client;
  let isolated: PrismaClient;

  beforeAll(async () => {
    app = await createE2eApplication();
    repository = app.get(BenchmarkSearchRepository);
    blocker = new Client({ connectionString: process.env.DB_URL });
    await blocker.connect();
    // One connection makes the timeout-reset assertions test actual pool reuse.
    isolated = new PrismaClient({ adapter: new PrismaPg({
      connectionString: process.env.DB_URL, max: 1,
      connectionTimeoutMillis: DATABASE_CONNECTION_TIMEOUT_MS,
    }) });
    await isolated.$connect();
  });

  afterEach(async () => { await blocker.query('ROLLBACK'); });
  afterAll(async () => {
    await blocker.end();
    await isolated.$disconnect();
    await app.close();
  });

  it.each(['hybrid', 'text fallback', 'legacy'] as const)(
    'cancels a blocked %s query on PostgreSQL and recovers after the lock is released', async (path) => {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE catalog_test_projections IN ACCESS EXCLUSIVE MODE');
      const run = () => {
        if ('text fallback' === path) return repository.searchText('timeoutfixture', 20);
        if ('legacy' === path) return repository.searchNaive('timeoutfixture', 20);
        return repository.search({ query: 'timeoutfixture', embedding: [1, 0],
          embeddingSpecId: 'timeout-fixture', limit: 20 });
      };
      const started = Date.now();
      await expect(run()).rejects.toThrow(/statement timeout/);
      expect(Date.now() - started).toBeLessThan(SEARCH_SQL_TIMEOUT_MS + 3_000);
      // The exclusive lock is still held: this failure was a server-side timeout.
      await blocker.query('ROLLBACK');
      await expect(run()).resolves.toEqual([]);
    }
  );

  it('restores the pooled connection setting after both success and server cancellation', async () => {
    const setting = async () => (await isolated.$queryRaw<Array<{ value: string }>>`
      SELECT current_setting('statement_timeout') AS value
    `)[0].value;
    const original = await setting();
    const [during] = await executeSearchQuery<{ value: string }>(isolated, Prisma.sql`
      SELECT current_setting('statement_timeout') AS value
    `);
    expect(during.value).toBe('3s');
    expect(await setting()).toBe(original);
    await expect(executeSearchQuery(isolated, Prisma.sql`SELECT 1 FROM pg_sleep(10)`))
      .rejects.toThrow(/statement timeout/);
    expect(await setting()).toBe(original);
    await expect(executeSearchQuery<{ value: number }>(isolated, Prisma.sql`SELECT 1 AS value`))
      .resolves.toEqual([{ value: 1 }]);
  });

  it('removes an expired pool waiter before it can open a late transaction', async () => {
    let release!: () => void;
    let started!: (pid: number) => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const acquired = new Promise<number>((resolve) => { started = resolve; });
    const owner = isolated.$transaction(async (transaction) => {
      const [row] = await transaction.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      started(row.pid);
      await hold;
    }, { timeout: 10_000 });
    try {
      const pid = await acquired;
      // The only connection is busy. pg must remove this waiter, not leave
      // a transaction startup running after Prisma has stopped waiting.
      await expect(executeSearchQuery(isolated, Prisma.sql`SELECT 1`))
        .rejects.toThrow(/timeout exceeded when trying to connect/);
      release();
      await owner;
      await expect(isolated.$queryRaw`SELECT 1`).resolves.toEqual([{ '?column?': 1 }]);
      const activity = await blocker.query<{ state: string; xact_start: Date | null }>(
        'SELECT state, xact_start FROM pg_stat_activity WHERE pid = $1', [pid]
      );
      expect(activity.rows).toEqual([{ state: 'idle', xact_start: null }]);
      await expect(executeSearchQuery<{ value: number }>(isolated, Prisma.sql`SELECT 1 AS value`))
        .resolves.toEqual([{ value: 1 }]);
    } finally {
      release();
      await owner;
    }
  });
});
