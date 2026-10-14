import { PrismaService } from '@/prisma/prisma.service';
import { CatalogTestUsageService } from '../catalog-test-usage.service';

describe('CatalogTestUsageService', () => {
  const prisma = { $queryRaw: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('counts Test usage from projections and pending commands in one query', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'domain-id', count: 2 }]);
    const service = new CatalogTestUsageService(prisma as unknown as PrismaService);

    await expect(
      service.countMany('domainIds', ['domain-id'])
    ).resolves.toEqual(new Map([['domain-id', 2]]));
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('does not query either store for an empty id set', async () => {
    const service = new CatalogTestUsageService(prisma as unknown as PrismaService);

    await expect(service.countMany('capabilityIds', [])).resolves.toEqual(
      new Map()
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('does not miss usage when the requested UUID uses uppercase letters', async () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    prisma.$queryRaw.mockResolvedValue([{ id, count: 1 }]);
    const service = new CatalogTestUsageService(prisma as unknown as PrismaService);

    await expect(service.count('difficultyId', id.toUpperCase())).resolves.toBe(1);
    expect(prisma.$queryRaw.mock.calls[0][0].values).toContain(id);
    expect(prisma.$queryRaw.mock.calls[0][0].values).not.toContain(id.toUpperCase());
  });
});
