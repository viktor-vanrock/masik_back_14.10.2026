export const KAFKA_TOPICS = {
  /** Catalog commands consumed by Benchmark Service. Kafka key: aggregateId. */
  benchmarkCommands: 'benchmark-service.commands.v1',

  /**
   * Benchmark Service produces versioned Test snapshots and tombstones.
   * Kafka key: testId.
   */
  benchmarkEvents: 'benchmark-service.events.v1',

  /** Poison Benchmark events that Catalog could not apply after retries. */
  benchmarkEventsDeadLetter: 'catalog-service.benchmark-events.dlq.v1',

  /**
   * Catalogue производит команды, Interviewer их читает.
   * Kafka key: requestId.
   */
  recommendationRequests: 'catalogue.recommendation.rerank.request.v2',

  /**
   * Interviewer производит результаты, Catalogue их читает.
   * Kafka key: requestId.
   */
  recommendationResults: 'interviewer.recommendation.rerank.result.v2',

  /**
   * Catalogue складывает сюда входящие записи, которые не удалось
   * обработать после ограниченного числа технических попыток.
   */
  recommendationResultsDeadLetter:
    'catalogue.recommendation.rerank.result.dlq.v2',
} as const;
