import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentEnvType } from '@/configs/types';
import { RecommendationCandidateSnapshot } from './types';

export type SelectedRecommendation = { testId: string; explanation: string };

@Injectable()
export class FactorySelectionService {
  private readonly logger = new Logger(FactorySelectionService.name);
  private readonly config: AgentEnvType;

  constructor(config: ConfigService) {
    this.config = config.getOrThrow<AgentEnvType>('agent');
    this.logger.log(`Recommendation selection mode: ${this.config.mode}`);
  }

  async select(
    requestId: string,
    query: string,
    candidates: readonly RecommendationCandidateSnapshot[],
    topK: number
  ): Promise<SelectedRecommendation[]> {
    if (0 === candidates.length) {
      this.logger.log(
        `Recommendation selection without model: requestId="${requestId}", reason="no_candidates", candidates=0`
      );
      return [];
    }
    if ('mock' === this.config.mode) {
      this.logger.warn(
        `Recommendation selection without model: requestId="${requestId}", mode="mock", ` +
        `reason="agent_mode_mock", candidates=${candidates.length}`
      );
      return candidates.slice(0, topK).map(({ testId }) => ({
        testId, explanation: 'Mock: выбран из кандидатов каталога.',
      }));
    }
    const url = this.config.selectionUrl
      ? new URL(this.config.selectionUrl)
      : new URL(this.config.wsUrl);
    if (!this.config.selectionUrl) {
      url.protocol = 'wss:' === url.protocol ? 'https:' : 'http:';
      url.pathname = '/api/v1/recommendations/select';
      url.search = '';
      url.hash = '';
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Invalid Factory selection URL');
    }
    const started = Date.now();
    const documentLimit = Math.min(24000, Math.floor(180000 / candidates.length));
    this.logger.log(`Factory selection started: requestId="${requestId}", candidates=${candidates.length}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        query, topK,
        candidates: candidates.map(({ testId, document, score }) => ({
          benchmarkId: testId, document: document.slice(0, documentLimit), score,
        })),
      }),
      signal: AbortSignal.timeout(this.config.selectionTimeoutMs ?? 195_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Factory selection failed: HTTP ${response.status}`);
    const payload: unknown = await response.json();
    const selected = this.validate(payload, candidates, topK);
    this.logger.log(`Factory selection completed: requestId="${requestId}", selected=${selected.length}, durationMs=${Date.now() - started}`);
    return selected;
  }

  private validate(
    payload: unknown,
    candidates: readonly RecommendationCandidateSnapshot[],
    topK: number
  ): SelectedRecommendation[] {
    if (!payload || 'object' !== typeof payload || !('recommendations' in payload) ||
      !Array.isArray(payload.recommendations) || payload.recommendations.length > topK) {
      throw new Error('Invalid Factory selection response');
    }
    const allowed = new Set(candidates.map((candidate) => candidate.testId));
    const seen = new Set<string>();
    return payload.recommendations.map((item: unknown) => {
      if (!item || 'object' !== typeof item || !('benchmarkId' in item) ||
        'string' !== typeof item.benchmarkId || !allowed.has(item.benchmarkId) ||
        seen.has(item.benchmarkId) || !('explanation' in item) ||
        'string' !== typeof item.explanation || !item.explanation.trim() || item.explanation.length > 4000) {
        throw new Error('Invalid Factory selected candidate');
      }
      seen.add(item.benchmarkId);
      return { testId: item.benchmarkId, explanation: item.explanation.trim() };
    });
  }
}
