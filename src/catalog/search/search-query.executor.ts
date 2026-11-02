import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

export const SEARCH_SQL_TIMEOUT_MS = 3_000;
const SEARCH_CONNECTION_WAIT_MS = 2_000;
const SEARCH_TRANSACTION_TIMEOUT_MS = 5_000;

/** Bound search on the server, including lock waits; never leak settings into the pool. */
export function executeSearchQuery<T>(
  prisma: Pick<PrismaService, '$transaction'>,
  query: Prisma.Sql
): Promise<T[]> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT set_config('statement_timeout', ${`${SEARCH_SQL_TIMEOUT_MS}ms`}, true)
    `;
    return transaction.$queryRaw<T[]>(query);
  }, {
    maxWait: SEARCH_CONNECTION_WAIT_MS,
    timeout: SEARCH_TRANSACTION_TIMEOUT_MS,
  });
}
