/**
 * Координаты конкретной записи внутри Kafka.
 *
 * Offset в KafkaJS приходит строкой, потому что Kafka использует 64-битные числа,
 * которые могут не помещаться в безопасный диапазон JavaScript number.
 */
export type KafkaMessageMetadata = Readonly<{
  topic: string;
  partition: number;
  offset: string;
}>;
