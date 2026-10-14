import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EmbeddingEnvType } from '@/configs/types';
import { PrismaService } from '@/prisma/prisma.service';

type DependencyHealth = Readonly<{
  status: 'up' | 'down';
  latencyMs: number;
  details?: Readonly<Record<string, unknown>>;
}>;

export type ReadinessReport = Readonly<{
  status: 'up' | 'down';
  timestamp: string;
  checks: Readonly<{
    database: DependencyHealth;
  }>;
}>;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService
  ) {
    this.embeddingSpecId = configService.getOrThrow<EmbeddingEnvType>(
      'embedding'
    ).specId;
  }

  private readonly embeddingSpecId: string;

  liveness() {
    return {
      status: 'up' as const,
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<ReadinessReport> {
    const database = await this.checkDatabase();

    return {
      status: database.status,
      timestamp: new Date().toISOString(),
      checks: {
        database,
      },
    };
  }

  private async checkDatabase(): Promise<DependencyHealth> {
    const startedAt = Date.now();

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const extensions = await this.prisma.$queryRaw<Array<{ version: string }>>`
        SELECT extversion AS "version"
        FROM pg_extension
        WHERE extname = 'vector'
      `;

      const vectorExtension = extensions[0];
      if (!vectorExtension) {
        throw new Error('pgvector extension is not installed');
      }

      const [searchIndex] = await this.prisma.$queryRaw<Array<{
        outOfSync: number;
      }>>`
        SELECT COUNT(*)::INTEGER AS "outOfSync"
        FROM "catalog_test_projections" AS tests
        INNER JOIN "catalog_benchmark_projections" AS suites
          ON suites."benchmark_id" = tests."benchmark_id"
        LEFT JOIN "catalog_entries" AS entries
          ON entries."test_id" = tests."test_id"
        LEFT JOIN "benchmark_search_documents" AS documents
          ON documents."benchmark_test_id" = tests."test_id"
        WHERE entries."status" = 'published'
          AND entries."archived_at" IS NULL
          AND tests."deleted_at" IS NULL
          AND tests."snapshot" IS NOT NULL
          AND tests."source_created_at" IS NOT NULL
          AND suites."deleted_at" IS NULL
          AND suites."name" IS NOT NULL
          AND suites."source_created_at" IS NOT NULL
          AND (
            documents."benchmark_test_id" IS NULL
            OR documents."source_updated_at" <> tests."source_updated_at"
            OR documents."embedding_spec_id" <> ${this.embeddingSpecId}
          )
      `;

      const outOfSync = searchIndex?.outOfSync ?? 0;

      return {
        status: 'up',
        latencyMs: Date.now() - startedAt,
        details: {
          pgvectorVersion: vectorExtension.version,
          searchIndex: outOfSync > 0 ? 'degraded' : 'synchronized',
          outOfSync,
          ...(outOfSync > 0 ? {
            reason: 'Embedding index is catching up; PostgreSQL text search remains available',
          } : {}),
        },
      };
    } catch {
      return {
        status: 'down',
        latencyMs: Date.now() - startedAt,
        details: {
          reason:
            'PostgreSQL, pgvector, or benchmark search index is unavailable',
        },
      };
    }
  }
}
