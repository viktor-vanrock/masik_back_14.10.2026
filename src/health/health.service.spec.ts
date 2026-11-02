import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import type { Response } from 'express';

describe('search readiness during embedding catch-up', () => {
  const queryRaw = jest.fn();
  const service = new HealthService(
    { $queryRaw: queryRaw } as unknown as PrismaService,
    { getOrThrow: () => ({ specId: 'gigachat-current' }) } as unknown as ConfigService
  );

  beforeEach(() => queryRaw.mockReset());

  const databaseWithIndex = (outOfSync: number) => queryRaw
    .mockResolvedValueOnce([{ '?column?': 1 }])
    .mockResolvedValueOnce([{ version: '0.8.0' }])
    .mockResolvedValueOnce([{ outOfSync }]);

  it('keeps readiness successful while vectors are missing or stale, with degraded diagnostics', async () => {
    databaseWithIndex(7);
    const status = jest.fn();
    const response = { status } as unknown as Response;
    const report = await new HealthController(service).readiness(response);

    expect(report.status).toBe('up');
    expect(report.checks.database).toEqual(expect.objectContaining({
      status: 'up',
      details: expect.objectContaining({
        pgvectorVersion: '0.8.0',
        searchIndex: 'degraded',
        outOfSync: 7,
      }),
    }));
    expect(report.checks.database.details?.reason).toContain('text search');
    expect(status).not.toHaveBeenCalled();
  });

  it('reports synchronized after all current published documents have embeddings', async () => {
    databaseWithIndex(0);
    const report = await service.readiness();

    expect(report.status).toBe('up');
    expect(report.checks.database.details).toEqual({
      pgvectorVersion: '0.8.0', searchIndex: 'synchronized', outOfSync: 0,
    });
  });

  it('still returns HTTP 503 when PostgreSQL is unavailable', async () => {
    queryRaw.mockRejectedValueOnce(new Error('database unavailable'));
    const status = jest.fn();
    const response = { status } as unknown as Response;
    const report = await new HealthController(service).readiness(response);

    expect(report.status).toBe('down');
    expect(report.checks.database.status).toBe('down');
    expect(status).toHaveBeenCalledWith(503);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('still requires the pgvector extension', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]).mockResolvedValueOnce([]);

    expect((await service.readiness()).status).toBe('down');
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('does not mistake a failed index diagnostic query for an embedding backlog', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }])
      .mockResolvedValueOnce([{ version: '0.8.0' }])
      .mockRejectedValueOnce(new Error('projection table missing'));

    expect((await service.readiness()).status).toBe('down');
  });
});
