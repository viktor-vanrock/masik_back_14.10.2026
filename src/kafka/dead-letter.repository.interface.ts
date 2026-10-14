import { KafkaMessageMetadata } from './contracts/kafka-message-metadata';

export type KafkaFailedMessage = Readonly<{
  metadata: KafkaMessageMetadata;
  key: string | null;
  value: string | null;
  headers: Readonly<Record<string, string>>;
}>;

export type RecordKafkaProcessingFailureParams = Readonly<{
  message: KafkaFailedMessage;
  error: string;
  maxAttempts: number;
  deadLetter: Readonly<{
    topic: string;
    eventType: string;
  }>;
}>;

export type KafkaProcessingFailureResult = Readonly<{
  disposition: 'retry' | 'dead_lettered';
  attempts: number;
  deadLetterEventId: string | null;
}>;

export abstract class IKafkaDeadLetterRepository {
  /**
   * Считает технические попытки по физической Kafka-позиции.
   * На последней попытке одной транзакцией создаёт Outbox-запись для DLQ.
   */
  abstract recordFailure(
    params: RecordKafkaProcessingFailureParams
  ): Promise<KafkaProcessingFailureResult>;

  /** Помечает ранее падавшую запись успешно обработанной. */
  abstract markResolved(metadata: KafkaMessageMetadata): Promise<void>;
}
