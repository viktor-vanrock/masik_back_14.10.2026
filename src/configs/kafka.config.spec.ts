import { readFileSync } from 'node:fs';
import kafkaConfig from './kafka.config';

jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  readFileSync: jest.fn(),
}));

describe('Kafka mTLS configuration', () => {
  const originalEnv = process.env;
  const readPem = readFileSync as jest.MockedFunction<typeof readFileSync>;

  beforeEach(() => {
    process.env = { ...originalEnv, KAFKA_ENABLED: 'true' };
    delete process.env.KAFKA_SSL_CA_FILE;
    delete process.env.KAFKA_SSL_CERT_FILE;
    delete process.env.KAFKA_SSL_KEY_FILE;
    delete process.env.NODE_ENV;
    readPem.mockReset();
    readPem.mockImplementation((path) => Buffer.from(String(path)));
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses Vault PEM files by default for Kafka on port 9094', () => {
    process.env.KAFKA_BROKERS = 'dev-broker:9094';

    const config = kafkaConfig();

    expect(readPem.mock.calls.map(([path]) => path)).toEqual([
      '/vault/secrets/kafka-ca.pem',
      '/vault/secrets/kafka-cert.pem',
      '/vault/secrets/kafka-key.pem',
    ]);
    expect(config.ssl).toEqual({
      ca: Buffer.from('/vault/secrets/kafka-ca.pem'),
      cert: Buffer.from('/vault/secrets/kafka-cert.pem'),
      key: Buffer.from('/vault/secrets/kafka-key.pem'),
      rejectUnauthorized: true,
    });
  });

  it('uses configured PEM paths when supplied', () => {
    process.env.KAFKA_BROKERS = 'dev-broker:9094';
    process.env.KAFKA_SSL_CA_FILE = '/custom/ca.pem';
    process.env.KAFKA_SSL_CERT_FILE = '/custom/cert.pem';
    process.env.KAFKA_SSL_KEY_FILE = '/custom/key.pem';

    kafkaConfig();

    expect(readPem.mock.calls.map(([path]) => path)).toEqual([
      '/custom/ca.pem',
      '/custom/cert.pem',
      '/custom/key.pem',
    ]);
  });

  it('fills unspecified PEM paths when one secure Kafka path is overridden', () => {
    process.env.KAFKA_BROKERS = 'dev-broker:9094';
    process.env.KAFKA_SSL_CA_FILE = '/custom/ca.pem';

    kafkaConfig();

    expect(readPem.mock.calls.map(([path]) => path)).toEqual([
      '/custom/ca.pem',
      '/vault/secrets/kafka-cert.pem',
      '/vault/secrets/kafka-key.pem',
    ]);
  });

  it('keeps local plaintext Kafka without certificates', () => {
    process.env.KAFKA_BROKERS = 'localhost:19092';

    expect(kafkaConfig().ssl).toBeUndefined();
    expect(readPem).not.toHaveBeenCalled();
  });

  it('requires Vault PEM files in production even when broker port differs', () => {
    process.env.NODE_ENV = 'production';
    process.env.KAFKA_BROKERS = 'prod-broker:9092';

    expect(kafkaConfig().ssl).toBeDefined();
    expect(readPem).toHaveBeenCalledTimes(3);
  });

  it('rejects partial PEM paths for local Kafka', () => {
    process.env.KAFKA_SSL_CA_FILE = '/custom/ca.pem';

    expect(() => kafkaConfig()).toThrow('must be configured together');
  });
});
