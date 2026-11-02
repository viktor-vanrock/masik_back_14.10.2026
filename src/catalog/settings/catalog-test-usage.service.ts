import { Injectable } from '@nestjs/common';
import { pendingTestReferences } from '@/benchmark-service/integration/benchmark-command-outbox.service';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

export type CatalogTestTaxonomyField =
  | 'macroGroupId'
  | 'taskTypeId'
  | 'languageId'
  | 'difficultyId'
  | 'subGroupIds'
  | 'abilityTaxonIds'
  | 'domainIds'
  | 'subdomainIds'
  | 'modalityIds'
  | 'capabilityIds';

type UsageRow = { id: string; count: number };

const columns: Record<
  CatalogTestTaxonomyField,
  { name: string; array: boolean }
> = {
  macroGroupId: { name: 'macro_group_id', array: false },
  taskTypeId: { name: 'task_type_id', array: false },
  languageId: { name: 'language_id', array: false },
  difficultyId: { name: 'difficulty_id', array: false },
  subGroupIds: { name: 'sub_group_ids', array: true },
  abilityTaxonIds: { name: 'ability_taxon_ids', array: true },
  domainIds: { name: 'domain_ids', array: true },
  subdomainIds: { name: 'subdomain_ids', array: true },
  modalityIds: { name: 'modality_ids', array: true },
  capabilityIds: { name: 'capability_ids', array: true },
};

@Injectable()
export class CatalogTestUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async count(field: CatalogTestTaxonomyField, id: string): Promise<number> {
    return (await this.countMany(field, [id])).get(id.toLowerCase()) ?? 0;
  }

  async countMany(
    field: CatalogTestTaxonomyField,
    ids: string[]
  ): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    ids = ids.map((id) => id.toLowerCase());
    const column = columns[field];
    const requestedIds = Prisma.join(
      ids.map((id) => Prisma.sql`${id}::UUID`)
    );
    const projected = column.array
      ? Prisma.sql`
          SELECT p."test_id"::TEXT AS test_id, used."id"::TEXT AS "id"
          FROM "catalog_test_projections" p
          INNER JOIN "catalog_benchmark_projections" b
            ON b."benchmark_id" = p."benchmark_id"
          CROSS JOIN LATERAL unnest(
            ${Prisma.raw(`p."${column.name}"`)}
          ) AS used("id")
          WHERE ${this.activeProjection()}
            AND used."id" IN (${requestedIds})
        `
      : Prisma.sql`
          SELECT p."test_id"::TEXT AS test_id,
            ${Prisma.raw(`p."${column.name}"`)}::TEXT AS "id"
          FROM "catalog_test_projections" p
          INNER JOIN "catalog_benchmark_projections" b
            ON b."benchmark_id" = p."benchmark_id"
          WHERE ${this.activeProjection()}
            AND ${Prisma.raw(`p."${column.name}"`)} IN (${requestedIds})
        `;
    const rows = await this.prisma.$queryRaw<UsageRow[]>(Prisma.sql`
      SELECT "id", COUNT(*)::INTEGER AS "count"
      FROM (
        ${projected}
        UNION
        SELECT pending.test_id, pending.id
        FROM (${pendingTestReferences(field)}) pending
        WHERE pending.id IN (${Prisma.join(ids)})
      ) references_used
      GROUP BY "id"
    `);

    return new Map(rows.map((row) => [row.id, row.count]));
  }

  private activeProjection(): Prisma.Sql {
    return Prisma.sql`
      p."deleted_at" IS NULL
      AND p."snapshot" IS NOT NULL
      AND p."benchmark_id" IS NOT NULL
      AND p."source_created_at" IS NOT NULL
      AND b."deleted_at" IS NULL
      AND b."name" IS NOT NULL
      AND b."source_created_at" IS NOT NULL
    `;
  }
}
