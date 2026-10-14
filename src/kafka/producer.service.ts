import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Partitioners, Producer, ProducerRecord } from 'kafkajs';
import { KafkaEnvType } from '@/configs/types';

@Injectable()
export class ProducerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ProducerService.name);
  private readonly producer: Producer;
  private connected = false;
  private shuttingDown = false;
  private connectionPromise: Promise<void> | undefined;
  private readonly enabled: boolean;

  constructor(configService: ConfigService) {
    const config = configService.getOrThrow<KafkaEnvType>('kafka');
    this.enabled = config.enabled;

    const kafka = new Kafka({
      clientId: `${config.clientId}-producer`,
      brokers: config.brokers,
      ssl: config.ssl,
      connectionTimeout: config.connectionTimeoutMs,
      requestTimeout: config.requestTimeoutMs,
    });

    this.producer = kafka.producer({
      allowAutoTopicCreation: false,
      createPartitioner: Partitioners.DefaultPartitioner,
    });
  }

  onModuleInit(): void {
    if (!this.enabled) return;

    /**
     * Kafka не является хранилищем бизнес-команды: сначала команда лежит
     * в PostgreSQL Outbox. Поэтому недоступная Kafka не должна ронять API.
     * Подключение продолжается лениво при каждой попытке Outbox publisher.
     */
    void this.ensureConnected().catch((error: unknown) => {
      this.logger.warn(
        `Kafka producer is not connected yet: ${this.errorMessage(error)}`
      );
    });
  }

  async onApplicationShutdown() {
    this.shuttingDown = true;

    await this.connectionPromise?.catch(() => undefined);

    if (this.connected) {
      await this.producer.disconnect();
    }

    this.connected = false;
    this.logger.log('Producer disconnected');
  }

  async produce(record: ProducerRecord) {
    if (!this.enabled) {
      throw new Error('Kafka producer is disabled');
    }

    await this.ensureConnected();

    return this.producer.send(record);
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (this.shuttingDown) {
      throw new Error('Kafka producer is shutting down');
    }

    if (!this.connectionPromise) {
      this.connectionPromise = this.producer
        .connect()
        .then(() => {
          this.connected = true;
          this.logger.log('Kafka producer connected');
        })
        .finally(() => {
          this.connectionPromise = undefined;
        });
    }

    await this.connectionPromise;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
