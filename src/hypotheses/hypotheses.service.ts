import { Inject, Injectable, Logger } from '@nestjs/common';
import { IHypothesesRepository } from './repository/hypotheses.repository.interface';
import {
  CreateGenerationParams,
  HypothesisGenerationWithHypotheses,
} from './types';

@Injectable()
export class HypothesesService {
  private readonly logger = new Logger(HypothesesService.name);

  constructor(
    @Inject(IHypothesesRepository)
    private readonly repository: IHypothesesRepository
  ) {}

  async createGeneration(
    params: CreateGenerationParams
  ): Promise<HypothesisGenerationWithHypotheses> {
    this.logger.debug(
      `Persisting hypothesis generation for conversationId="${params.conversationId}", count=${params.hypotheses.length}`
    );

    return this.repository.createGeneration(params);
  }

  async findByConversationId(
    conversationId: string
  ): Promise<HypothesisGenerationWithHypotheses[]> {
    this.logger.debug(
      `Fetching hypothesis generations for conversationId="${conversationId}"`
    );

    return this.repository.findByConversationId(conversationId);
  }
}
