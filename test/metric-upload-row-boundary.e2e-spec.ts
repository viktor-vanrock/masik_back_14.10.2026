import { INestApplication } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { createE2eApplication } from './support/create-e2e-application';

describe('Metric upload staging boundary (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.metricUploadRow.deleteMany();
    await app.close();
  });

  it('stores resolved remote Benchmark/Test ids without source-table foreign keys', async () => {
    const benchmarkId = 'remote-benchmark-id';
    const testId = 'remote-test-id';

    await expect(
      prisma.metricUploadRow.create({
        data: {
          benchmarkId,
          testId,
          rawModelName: 'Remote Model',
          rawBenchmarkName: 'Remote Benchmark',
          rawTestName: 'Remote Test',
          rawMetricName: 'accuracy',
          metricValue: 0.91,
          obtainedAt: new Date('2026-09-12T10:00:00.000Z'),
          rawPayload: { source: 'boundary-test' },
        },
      })
    ).resolves.toMatchObject({ benchmarkId, testId });
  });
});
