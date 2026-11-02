import { Module } from '@nestjs/common';
import { BenchmarkSearchModule } from '@/catalog/search/benchmark-search.module';
import { FactorySelectionService } from './factory-selection.service';
import { RecommendationRequestsService } from './recommendation-requests.service';
import { RecommendationsService } from './recommendations.service';
import { RecommendationCandidateReferenceService } from './repository/recommendation-candidate-reference.service';
import { recommendationRequestsRepositoryProvider } from './repository/recommendation-requests.repository.provider';
import { recommendationsRepositoryProvider } from './repository/recommendations.repository.provider';

@Module({
  imports: [BenchmarkSearchModule],
  providers: [
    FactorySelectionService,
    RecommendationsService,
    RecommendationRequestsService,
    RecommendationCandidateReferenceService,
    recommendationsRepositoryProvider,
    recommendationRequestsRepositoryProvider,
  ],
  exports: [
    RecommendationsService,
    RecommendationRequestsService,
  ],
})
export class RecommendationsModule {}
