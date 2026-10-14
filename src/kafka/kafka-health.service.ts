import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka } from 'kafkajs';

import { KafkaEnvType } from '@/configs/types';

import { KAFKA_TOPICS } from './kafka.constants';

export type KafkaHealthResult = Readonly<{
  latencyMs: number;
  topics: readonly string[];
}>;

@Injectable()
export class KafkaHealthService {
  private readonly kafka: Kafka;

  constructor(configService: ConfigService) {
    const config = configService.getOrThrow<KafkaEnvType>('kafka');

    this.kafka = new Kafka({
      clientId: `${config.clientId}-health`,
      brokers: config.brokers,
      ssl: config.ssl,
      connectionTimeout: config.connectionTimeoutMs,
      requestTimeout: config.requestTimeoutMs,
    });
  }

  async check(): Promise<KafkaHealthResult> {
    const startedAt = Date.now();
    const admin = this.kafka.admin();
    const requiredTopics = Object.values(KAFKA_TOPICS);

    try {
      await admin.connect();

      /**
       * Проверяем не только broker, но и наличие контрактных topics.
       * Живой broker без нужного topic всё равно не готов к интеграции.
       */
      const metadata = await admin.fetchTopicMetadata({
        topics: requiredTopics,
      });
      const availableTopics = new Set(
        metadata.topics.map((topic) => topic.name)
      );
      const missingTopics = requiredTopics.filter(
        (topic) => !availableTopics.has(topic)
      );

      if (missingTopics.length > 0) {
        throw new Error(
          `Kafka topics are missing: ${missingTopics.join(', ')}`
        );
      }

      return {
        latencyMs: Date.now() - startedAt,
        topics: requiredTopics,
      };
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
  }
}
