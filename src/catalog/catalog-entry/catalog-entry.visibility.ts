import {
  BenchmarkValidationStatus,
  CatalogEntry,
  Prisma,
} from '@/generated/prisma/client';

export const publishedCatalogEntryWhere = {
  status: BenchmarkValidationStatus.published,
  archivedAt: null,
} satisfies Prisma.CatalogEntryWhereInput;

type CatalogEntryClient = Pick<Prisma.TransactionClient, 'catalogEntry'>;

export async function publishedTestIds(
  client: CatalogEntryClient
): Promise<string[]> {
  const entries = await client.catalogEntry.findMany({
    where: publishedCatalogEntryWhere,
    select: { testId: true },
  });
  return entries.map(({ testId }) => testId);
}

export async function attachCatalogEntries<T extends { id: string }>(
  client: CatalogEntryClient,
  tests: T[]
): Promise<Array<T & { catalogEntry: CatalogEntry | null }>> {
  if (0 === tests.length) return [];
  const entries = await client.catalogEntry.findMany({
    where: { testId: { in: tests.map(({ id }) => id) } },
  });
  const byTestId = new Map(entries.map((entry) => [entry.testId, entry]));
  return tests.map((test) => ({
    ...test,
    catalogEntry: byTestId.get(test.id) ?? null,
  }));
}

export async function attachCatalogEntry<T extends { id: string }>(
  client: CatalogEntryClient,
  test: T | null
): Promise<(T & { catalogEntry: CatalogEntry | null }) | null> {
  if (!test) return null;
  const [attached] = await attachCatalogEntries(client, [test]);
  return attached;
}

export function catalogStatusOf(test: {
  catalogEntry?: { status: BenchmarkValidationStatus } | null;
}): BenchmarkValidationStatus | null {
  return test.catalogEntry?.status ?? null;
}
