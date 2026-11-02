import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsumerCrashEvent, EachMessagePayload, IHeaders } from 'kafkajs';

import {
  BENCHMARK_MESSAGE_TYPES,
  parseBenchmarkIntegrationMessageV1,
} from '@/benchmark-service/contracts/benchmark-integration.v1';
import { KafkaEnvType } from '@/configs/types';
import { ConsumerService } from '@/kafka/consumer.service';
import { IKafkaDeadLetterRepository } from '@/kafka/dead-letter.repository.interface';
import { KAFKA_TOPICS } from '@/kafka/kafka.constants';

import { BenchmarkSearchService } from '../search/benchmark-search.service';
import { CatalogBenchmarkProjectionService } from './catalog-benchmark-projection.service';

const BENCHMARK_EVENT_DEAD_LETTER_TYPE = 'catalog.benchmark-event.dead-lettered.v1';

@Injectable()
export class CatalogBenchmarkEventsConsumer
implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(CatalogBenchmarkEventsConsumer.name);
  private readonly enabled: boolean;
  private readonly restartDelayMs: number;
  private readonly maxProcessingAttempts: number;
  private stopped = false;
  private started = false;
  private starting = false;
  private restartTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly consumer: ConsumerService,
    private readonly projection: CatalogBenchmarkProjectionService,
    private readonly search: BenchmarkSearchService,
    private readonly deadLetterRepository: IKafkaDeadLetterRepository,
    configService: ConfigService
  ) {
    const config = configService.getOrThrow<KafkaEnvType>('kafka');
    this.enabled = config.enabled;
    this.restartDelayMs = config.consumerRestartDelayMs;
    this.maxProcessingAttempts = config.consumerMaxProcessingAttempts;
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Catalog Benchmark events consumer is disabled');
      return;
    }

    this.stopped = false;
    this.scheduleStart(0);
  }

  beforeApplicationShutdown(): void {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
  }

  private scheduleStart(delayMs: number): void {
    if (this.stopped || this.started || this.starting || this.restartTimer) {
      return;
    }

    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      void this.start().catch((error: unknown) => {
        this.logger.warn(`Catalog Benchmark consumer startup failed: ${this.errorMessage(error)}`);
        this.scheduleStart(this.restartDelayMs);
      });
    }, delayMs);
    this.restartTimer.unref();
  }

  private async start(): Promise<void> {
    if (this.stopped || this.started || this.starting) return;

    this.starting = true;
    try {
      await this.consumer.consume(
        {
          topics: [KAFKA_TOPICS.benchmarkEvents],
          // Rebuildable projection + Inbox make retained-event replay safe.
          fromBeginning: true,
        },
        {
          eachMessage: (payload) => this.handleMessage(payload),
        },
        {
          onCrash: (event) => this.handleCrash(event),
        }
      );
      this.started = true;
    } finally {
      this.starting = false;
    }
  }

  private handleCrash(event: ConsumerCrashEvent): void {
    if (event.payload.restart || this.stopped) return;

    this.started = false;
    this.logger.warn(
      `Catalog Benchmark consumer crashed: ${this.errorMessage(event.payload.error)}`
    );
    this.scheduleStart(this.restartDelayMs);
  }

  private async handleMessage(payload: EachMessagePayload): Promise<void> {
    const metadata = {
      topic: payload.topic,
      partition: payload.partition,
      offset: payload.message.offset,
    } as const;
    const key = payload.message.key?.toString('utf8') ?? null;
    const value = payload.message.value?.toString('utf8') ?? null;
    const headers = this.stringifyHeaders(payload.message.headers);

    try {
      if (KAFKA_TOPICS.benchmarkEvents !== payload.topic) {
        throw new Error(`Unexpected Kafka topic: "${payload.topic}"`);
      }
      if (null === value) throw new Error('Kafka message value is required');

      let parsed: unknown;
      try {
        parsed = JSON.parse(value) as unknown;
      } catch {
        throw new Error('Kafka message value must be valid JSON');
      }

      const message = parseBenchmarkIntegrationMessageV1(parsed);
      if (key !== message.aggregateId) {
        throw new Error('Kafka message key must equal the Benchmark aggregateId');
      }

      await this.projection.apply(message, metadata);
      await this.synchronizeSearch(message);
      await this.deadLetterRepository.markResolved(metadata);
    } catch (error: unknown) {
      const failure = await this.deadLetterRepository.recordFailure({
        message: { metadata, key, value, headers },
        error: this.errorMessage(error),
        maxAttempts: this.maxProcessingAttempts,
        deadLetter: {
          topic: KAFKA_TOPICS.benchmarkEventsDeadLetter,
          eventType: BENCHMARK_EVENT_DEAD_LETTER_TYPE,
        },
      });

      if ('retry' === failure.disposition) throw error;

      this.logger.error(
        'Catalog skipped a poison Benchmark event after ' +
          `${failure.attempts} attempts: topic="${metadata.topic}", ` +
          `partition=${metadata.partition}, offset=${metadata.offset}`
      );
    }
  }

  private async synchronizeSearch(
    message: ReturnType<typeof parseBenchmarkIntegrationMessageV1>
  ): Promise<void> {
    switch (message.eventType) {
      case BENCHMARK_MESSAGE_TYPES.testSnapshot:
      case BENCHMARK_MESSAGE_TYPES.testDeleted:
        await this.search.indexBenchmark(message.aggregateId);
        return;
      case BENCHMARK_MESSAGE_TYPES.suiteSnapshot:
      case BENCHMARK_MESSAGE_TYPES.suiteDeleted:
        await this.search.reindexSuite(message.aggregateId);
        return;
      default:
        return;
    }
  }

  private stringifyHeaders(headers: IHeaders | undefined): Readonly<Record<string, string>> {
    return Object.fromEntries(
      Object.entries(headers ?? {}).map(([name, value]) => [
        name,
        Array.isArray(value)
          ? value.map((item) => item.toString()).join(',')
          : (value?.toString() ?? ''),
      ])
    );
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
