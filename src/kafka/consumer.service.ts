import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Consumer,
  ConsumerCrashEvent,
  ConsumerSubscribeTopics,
  ConsumerRunConfig,
  Kafka,
} from 'kafkajs';
import { KafkaEnvType } from '@/configs/types';

export type KafkaConsumerLifecycle = Readonly<{
  onCrash?: (event: ConsumerCrashEvent) => void;
}>;

@Injectable()
export class ConsumerService implements OnApplicationShutdown {
  private readonly logger = new Logger(ConsumerService.name);
  private readonly consumers: Consumer[] = [];
  private readonly connectedConsumers = new Set<Consumer>();
  private readonly consumerGroupId: string;
  private readonly kafka: Kafka;

  constructor(configService: ConfigService) {
    const config = configService.getOrThrow<KafkaEnvType>('kafka');

    this.kafka = new Kafka({
      clientId: `${config.clientId}-consumer`,
      brokers: config.brokers,
      ssl: config.ssl,
      connectionTimeout: config.connectionTimeoutMs,
      requestTimeout: config.requestTimeoutMs,
    });

    this.consumerGroupId = config.consumerGroupId;
  }

  async consume(
    subscription: ConsumerSubscribeTopics,
    config: ConsumerRunConfig,
    lifecycle?: KafkaConsumerLifecycle
  ) {
    const consumer = this.kafka.consumer({
      groupId: this.consumerGroupId,
      allowAutoTopicCreation: false,
    });

    consumer.on(consumer.events.CONNECT, () => {
      this.connectedConsumers.add(consumer);
    });
    consumer.on(consumer.events.DISCONNECT, () => {
      this.connectedConsumers.delete(consumer);
    });
    consumer.on(consumer.events.CRASH, (event) => {
      this.connectedConsumers.delete(consumer);
      lifecycle?.onCrash?.(event);
    });

    try {
      await consumer.connect();
      await consumer.subscribe(subscription);
      await consumer.run(config);

      this.consumers.push(consumer);
      this.logger.log(
        `Kafka consumer connected: groupId=${this.consumerGroupId}`
      );
    } catch (err) {
      try {
        await consumer.disconnect();
      } catch (disconnectError: unknown) {
        const message =
          disconnectError instanceof Error
            ? disconnectError.message
            : String(disconnectError);
        this.logger.warn(
          `Kafka consumer cleanup failed after startup error: ${message}`
        );
      } finally {
        // Не полагаемся на то, что KafkaJS успеет доставить DISCONNECT event:
        // subscribe/run может упасть сразу после CONNECT.
        this.connectedConsumers.delete(consumer);
      }
      throw err;
    }
  }

  async onApplicationShutdown() {
    for (const consumer of this.consumers) {
      await consumer.disconnect();
    }

    this.connectedConsumers.clear();

    this.logger.log('Kafka consumers disconnected');
  }

  /** Readiness требует хотя бы один подключённый business consumer. */
  isConnected(): boolean {
    return this.connectedConsumers.size > 0;
  }
}
