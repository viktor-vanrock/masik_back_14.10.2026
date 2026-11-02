import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingEnvType } from '@/configs/types';
import { BenchmarkValidationStatus } from '@/generated/prisma/enums';
import { catalogStatusOf } from '../catalog-entry/catalog-entry.visibility';
import { BenchmarkSearchDocumentBuilder } from './benchmark-search-document.builder';
import { BenchmarkSearchRepository } from './benchmark-search.repository';
import { EmbeddingService } from './embedding.service';
import { BenchmarkRetrievalResult, BenchmarkSearchSource, SearchDocumentRow } from './types';

@Injectable()
export class BenchmarkSearchService {
  private readonly logger = new Logger(BenchmarkSearchService.name);
  private readonly config: EmbeddingEnvType;

  constructor(
    private readonly repository: BenchmarkSearchRepository,
    private readonly documentBuilder: BenchmarkSearchDocumentBuilder,
    private readonly embeddings: EmbeddingService,
    configService: ConfigService
  ) {
    this.config = configService.getOrThrow<EmbeddingEnvType>('embedding');
  }

  async retrieve(query: string, requestId?: string): Promise<BenchmarkRetrievalResult> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error('Retrieval query must not be empty');

    const startedAt = Date.now();
    let fallbackReason: BenchmarkRetrievalResult['fallbackReason'] = 'embedding_failed';
    try {
      const embedding = await this.embeddings.embedQuery(normalizedQuery, AbortSignal.timeout(15_000));
      fallbackReason = 'hybrid_search_failed';
      const rows = await this.repository.search({
        query: normalizedQuery,
        embedding: embedding.values,
        embeddingSpecId: this.embeddings.specId,
        limit: this.config.retrievalCandidateLimit,
      });
      if (rows.length) {
        return this.retrievalResult(rows,
          `${this.embeddings.specId}:dim-${embedding.dimensions}:pgvector-fts-ru-en-rrf60-v1`, startedAt);
      }
      fallbackReason = 'hybrid_search_empty';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Hybrid retrieval failed: requestId=${JSON.stringify(requestId ?? null)}, ` +
        `reason="${fallbackReason}", error=${JSON.stringify(message)}`
      );
    }
    this.logger.warn(
      `Using projection text search: requestId=${JSON.stringify(requestId ?? null)}, ` +
      `reason="${fallbackReason}"`
    );
    const rows = await this.repository.searchText(normalizedQuery, this.config.retrievalCandidateLimit);
    return { ...this.retrievalResult(rows, 'postgres-fts-ru-en-v1', startedAt), fallbackReason };
  }

  private retrievalResult(
    rows: SearchDocumentRow[],
    retrievalVersion: string,
    startedAt: number
  ): BenchmarkRetrievalResult {
    return {
      candidates: rows.map((row) => ({
        testId: row.testId,
        document: row.document,
        score: Number(row.score),
        sourceUpdatedAt: row.sourceUpdatedAt.toISOString(),
      })),
      retrievalVersion,
      durationMs: Date.now() - startedAt,
    };
  }

  async searchForLegacyInterviewer(query: string, topK: number) {
    const rows = await this.repository.searchNaive(query, topK);
    return {
      retrieval_version: 'postgres-substring-v1',
      candidates: rows.map((row) => ({
        // The legacy Factory name identifies a Test, not its parent Benchmark.
        benchmark_id: row.testId,
        dataset_id: row.datasetId ?? `benchmark-test:${row.testId}`,
        score: Number(row.score),
        benchmark_description: row.document.trim().slice(0, 4000) || row.testId,
        dataset_description: row.datasetDescription.trim().slice(0, 2000),
      })),
    };
  }

  async searchForInterviewerAgent(query: string, topK: number) {
    const retrieval = await this.retrieve(query);
    return {
      retrieval_version: retrieval.retrievalVersion,
      candidates: retrieval.candidates.slice(0, topK).map((candidate) => ({
        benchmark_id: candidate.testId,
        benchmark_description: candidate.document.trim().slice(0, 12000) || candidate.testId,
        score: candidate.score,
        source_updated_at: candidate.sourceUpdatedAt,
      })),
    };
  }

  async indexBenchmark(benchmarkTestId: string): Promise<'indexed' | 'removed' | 'synchronized'> {
    const source = await this.repository.findSource(benchmarkTestId);

    if (!this.isSearchable(source)) {
      await this.repository.deleteDocument(benchmarkTestId);
      return 'removed';
    }

    const document = this.buildDocument(source);
    const contentHash = this.hash(document);
    const current = await this.repository.findDocumentState(benchmarkTestId);
    if (
      current?.contentHash === contentHash &&
      current.embeddingSpecId === this.embeddings.specId
    ) {
      if (current.sourceUpdatedAt.getTime() !== source.updatedAt.getTime()) {
        await this.repository.touchDocumentSourceUpdatedAt(benchmarkTestId, source.updatedAt);
      }
      return 'synchronized';
    }

    const embedding = await this.embeddings.embedDocument(document);

    await this.repository.upsertDocument({
      benchmarkTestId: source.id,
      documentText: document,
      contentHash,
      embedding: embedding.values,
      embeddingSpecId: this.embeddings.specId,
      sourceUpdatedAt: source.updatedAt,
    });

    this.logger.log(`Benchmark search document indexed: id="${source.id}"`);
    return 'indexed';
  }

  async reindexSuite(benchmarkId: string): Promise<number> {
    const [publishedIds, projectionIds] = await Promise.all([
      this.repository.findPublishedIdsBySuite(benchmarkId),
      this.repository.findProjectionIdsBySuite(benchmarkId),
    ]);
    const published = new Set(publishedIds);
    await Promise.all(
      projectionIds
        .filter((id) => !published.has(id))
        .map((id) => this.repository.deleteDocument(id))
    );
    for (const id of publishedIds) await this.indexBenchmark(id);
    return publishedIds.length;
  }

  async reindexAll(): Promise<{ indexed: number; failed: number }> {
    const ids = await this.repository.findPublishedIds();
    await this.repository.invalidateAllDocuments();
    await this.repository.deleteDocumentsOutsideSpec(this.embeddings.specId);

    let indexed = 0;
    let failed = 0;

    for (let offset = 0; offset < ids.length; offset += this.embeddings.batchSize) {
      const batch = ids.slice(offset, offset + this.embeddings.batchSize);
      try {
        await this.indexIds(batch);
        indexed += batch.length;
      } catch (error: unknown) {
        failed += batch.length;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Benchmark search reindex batch failed: offset=${offset}, ` +
            `count=${batch.length}, error="${message}"`
        );
      }
    }

    return { indexed, failed };
  }

  async removeBenchmark(benchmarkTestId: string): Promise<void> {
    await this.repository.deleteDocument(benchmarkTestId);
  }

  private async indexIds(ids: readonly string[]): Promise<void> {
    if (0 === ids.length) return;

    const sources = (await this.repository.findSources(ids)).filter(
      (source): source is BenchmarkSearchSource => this.isSearchable(source)
    );
    const documents = sources.map((source) => this.buildDocument(source));
    const embeddings = await this.embeddings.embedDocuments(documents);

    if (embeddings.length !== sources.length) {
      throw new Error('Embedding batch result length does not match source length');
    }

    for (const [index, source] of sources.entries()) {
      const embedding = embeddings[index];
      const document = documents[index];
      if (!embedding || !document) throw new Error('Embedding batch is incomplete');

      await this.repository.upsertDocument({
        benchmarkTestId: source.id,
        documentText: document,
        contentHash: this.hash(document),
        embedding: embedding.values,
        embeddingSpecId: this.embeddings.specId,
        sourceUpdatedAt: source.updatedAt,
      });
    }
  }

  private isSearchable(source: BenchmarkSearchSource | null): source is BenchmarkSearchSource {
    return Boolean(
      source &&
      !source.deletedAt &&
      !source.benchmark.deletedAt &&
      !source.catalogEntry?.archivedAt &&
      BenchmarkValidationStatus.published === catalogStatusOf(source)
    );
  }

  private buildDocument(source: BenchmarkSearchSource): string {
    return this.documentBuilder.build(source).trim();
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
