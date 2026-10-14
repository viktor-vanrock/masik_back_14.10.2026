import { Module } from '@nestjs/common';
import { BenchmarkJobsController } from './benchmark-jobs.controller';
import { BenchmarkJobsService } from './benchmark-jobs.service';
import { GenerationController } from './generation.controller';
import { InterviewerServiceTokenGuard } from './interviewer-service-token.guard';
import { ProductionJobsController } from './production-jobs.controller';
import { ProductionJobsService } from './production-jobs.service';
import { ProductionController } from './production.controller';

@Module({
  controllers: [BenchmarkJobsController, GenerationController, ProductionController, ProductionJobsController],
  providers: [BenchmarkJobsService, ProductionJobsService, InterviewerServiceTokenGuard],
  exports: [BenchmarkJobsService],
})
export class GenerationModule {}
