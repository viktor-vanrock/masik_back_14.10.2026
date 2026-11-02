import { Module } from '@nestjs/common';
import { InterviewerServiceTokenGuard } from '@/generation/interviewer-service-token.guard';
import { CatalogProjectionReadModule } from '../projection/catalog-projection-read.module';
import { BenchmarkSearchDocumentBuilder } from './benchmark-search-document.builder';
import { BenchmarkSearchRepository } from './benchmark-search.repository';
import { BenchmarkSearchService } from './benchmark-search.service';
import { EmbeddingService } from './embedding.service';
import { InterviewerBenchmarkSearchController } from './interviewer-benchmark-search.controller';

@Module({
  imports: [CatalogProjectionReadModule],
  controllers: [InterviewerBenchmarkSearchController],
  providers: [
    InterviewerServiceTokenGuard,
    BenchmarkSearchDocumentBuilder,
    BenchmarkSearchRepository,
    BenchmarkSearchService,
    EmbeddingService,
  ],
  exports: [BenchmarkSearchService],
})
export class BenchmarkSearchModule {}
