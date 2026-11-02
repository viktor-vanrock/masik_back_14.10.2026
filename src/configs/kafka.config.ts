import { readFileSync } from 'node:fs';
import { registerAs } from '@nestjs/config';
import { KafkaEnvType } from './types';

export default registerAs('kafka', (): KafkaEnvType => {
  const enabled = parseBoolean(process.env.KAFKA_ENABLED, false);
  const brokers = parseBrokers(process.env.KAFKA_BROKERS);
  const ssl = kafkaSslOptions(enabled, brokers);

  return {
    enabled,
    clientId: process.env.KAFKA_CLIENT_ID?.trim() || 'benchmark-catalog',
    brokers,
    ssl,
    consumerGroupId:
      process.env.KAFKA_CONSUMER_GROUP_ID?.trim() ||
      'benchmark-catalog-recommendation-rerank-results-v2',
    connectionTimeoutMs: parsePositiveInteger(
      process.env.KAFKA_CONNECTION_TIMEOUT_MS,
      5_000
    ),
    requestTimeoutMs: parsePositiveInteger(
      process.env.KAFKA_REQUEST_TIMEOUT_MS,
      30_000
    ),
    consumerRestartDelayMs: parsePositiveInteger(
      process.env.KAFKA_CONSUMER_RESTART_DELAY_MS,
      5_000
    ),
    consumerMaxProcessingAttempts: parsePositiveInteger(
      process.env.KAFKA_CONSUMER_MAX_PROCESSING_ATTEMPTS,
      5
    ),
    recommendationMaxAttempts: parsePositiveInteger(
      process.env.KAFKA_RECOMMENDATION_MAX_ATTEMPTS,
      3
    ),
    recommendationRetryBaseDelayMs: parsePositiveInteger(
      process.env.KAFKA_RECOMMENDATION_RETRY_BASE_DELAY_MS,
      5_000
    ),
    recommendationRetryMaxDelayMs: parsePositiveInteger(
      process.env.KAFKA_RECOMMENDATION_RETRY_MAX_DELAY_MS,
      60_000
    ),
  };
});

function kafkaSslOptions(
  enabled: boolean,
  brokers: string[]
): KafkaEnvType['ssl'] {
  const caFile = process.env.KAFKA_SSL_CA_FILE?.trim();
  const certFile = process.env.KAFKA_SSL_CERT_FILE?.trim();
  const keyFile = process.env.KAFKA_SSL_KEY_FILE?.trim();
  const configured = [caFile, certFile, keyFile].filter(Boolean).length;
  const requiresMtls =
    enabled &&
    ('production' === process.env.NODE_ENV?.trim() ||
      brokers.some((broker) => broker.endsWith(':9094')));

  if (0 === configured && !requiresMtls) return undefined;
  if (!requiresMtls && configured > 0 && configured !== 3) {
    throw new Error(
      'KAFKA_SSL_CA_FILE, KAFKA_SSL_CERT_FILE and KAFKA_SSL_KEY_FILE must be configured together.'
    );
  }

  return {
    ca: readFileSync(caFile || '/vault/secrets/kafka-ca.pem'),
    cert: readFileSync(certFile || '/vault/secrets/kafka-cert.pem'),
    key: readFileSync(keyFile || '/vault/secrets/kafka-key.pem'),
    rejectUnauthorized: true,
  };
}

const parseBoolean = (
  value: string | undefined,
  fallback: boolean
): boolean => {
  if (undefined === value) return fallback;
  return 'true' === value.trim().toLowerCase();
};

const parseBrokers = (value: string | undefined): string[] => {
  return (value ?? 'localhost:9092')
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);
};

/**
 * Некорректное необязательное значение не должно превращать retry в NaN.
 * Строгую проверку обязательных секретов выполняет assertEnvConfig,
 * а для числовых Kafka-настроек безопасно используем документированный default.
 */
const parsePositiveInteger = (
  value: string | undefined,
  fallback: number
): number => {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
