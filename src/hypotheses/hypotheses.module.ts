import { Module } from '@nestjs/common';
import { HypothesesService } from './hypotheses.service';
import { hypothesesRepositoryProvider } from './repository/hypotheses.repository.provider';

@Module({
  providers: [
    HypothesesService,
    hypothesesRepositoryProvider,
  ],
  exports: [HypothesesService],
})
export class HypothesesModule {}
