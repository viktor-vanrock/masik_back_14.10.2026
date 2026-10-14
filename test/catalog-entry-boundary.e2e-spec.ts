import { INestApplication } from '@nestjs/common';
import { BenchmarkValidationStatus } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { createE2eApplication } from './support/create-e2e-application';

describe('CatalogEntry database boundary (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.catalogTestProjection.deleteMany();
    await prisma.catalogEntry.deleteMany();
  });

  afterAll(async () => {
    await prisma.catalogTestProjection.deleteMany();
    await prisma.catalogEntry.deleteMany();
    await app.close();
  });

  it('stores moderation by remote Test id', async () => {
    const remoteTestId = '10000000-0000-4000-8000-000000000001';

    await expect(
      prisma.catalogEntry.create({
        data: {
          testId: remoteTestId,
          status: BenchmarkValidationStatus.validation,
        },
      })
    ).resolves.toMatchObject({ testId: remoteTestId });

  });

  it('does not erase Catalog moderation when a remote projection is removed', async () => {
    const testId = '20000000-0000-4000-8000-000000000002';
    await prisma.catalogTestProjection.create({
      data: {
        testId,
        benchmarkId: '30000000-0000-4000-8000-000000000003',
        aggregateVersion: 1,
        snapshot: { id: testId },
        name: 'Projected Test',
        nameEn: 'Projected Test EN',
        sourceCreatedAt: new Date('2026-09-14T00:00:00.000Z'),
        sourceUpdatedAt: new Date('2026-09-14T00:00:00.000Z'),
      },
    });
    const entry = await prisma.catalogEntry.create({
      data: {
        testId,
        status: BenchmarkValidationStatus.published,
      },
    });

    await prisma.catalogTestProjection.delete({ where: { testId } });

    await expect(
      prisma.catalogEntry.findUniqueOrThrow({ where: { id: entry.id } })
    ).resolves.toMatchObject({
      testId,
      status: BenchmarkValidationStatus.published,
    });
  });
});
