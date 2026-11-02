import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConsumerService } from './consumer.service';
import { IKafkaDeadLetterRepository } from './dead-letter.repository.interface';
import { kafkaDeadLetterRepositoryProvider } from './dead-letter.repository.provider';
import { KafkaHealthService } from './kafka-health.service';
import { OutboxPublisherService } from './outbox/outbox-publisher.service';
import { outboxRepositoryProvider } from './outbox/outbox.repository.provider';
import { ProducerService } from './producer.service';

@Module({
  imports: [ConfigModule],
  providers: [
    ProducerService,
    ConsumerService,
    KafkaHealthService,
    kafkaDeadLetterRepositoryProvider,
    outboxRepositoryProvider,
    OutboxPublisherService,
  ],
  exports: [
    ProducerService,
    ConsumerService,
    KafkaHealthService,
    IKafkaDeadLetterRepository,
  ],
})
export class KafkaModule {}
