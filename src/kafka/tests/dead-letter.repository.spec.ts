import { KafkaProcessingFailureStatus } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

import { KafkaDeadLetterRepository } from '../dead-letter.repository';

describe('KafkaDeadLetterRepository', () => {
  const failureFindUnique = jest.fn();
  const failureUpsert = jest.fn();
  const outboxCreate = jest.fn();
  const prismaTransaction = jest.fn();

  const transactionClient = {
    kafkaProcessingFailure: {
      findUnique: failureFindUnique,
      upsert: failureUpsert,
    },
    outboxMessage: {
      create: outboxCreate,
    },
  };

  const prisma = {
    $transaction: prismaTransaction,
  } as unknown as PrismaService;
  const repository = new KafkaDeadLetterRepository(prisma);

  const message = {
    metadata: {
      topic: 'interviewer.recommendation.rerank.result.v2',
      partition: 1,
      offset: '42',
    },
    key: '11111111-1111-4111-8111-111111111111',
    value: '{not-json}',
    headers: {
      'content-type': 'application/json',
    },
  } as const;
  const deadLetter = {
    topic: 'catalogue.recommendation.rerank.result.dlq.v2',
    eventType: 'catalogue.recommendation.rerank.result.dead-lettered',
  } as const;

  beforeEach(() => {
    jest.resetAllMocks();
    prismaTransaction.mockImplementation(async (callback) =>
      callback(transactionClient)
    );
    failureFindUnique.mockResolvedValue(null);
    failureUpsert.mockResolvedValue({});
    outboxCreate.mockResolvedValue({});
  });

  it('records a retry without creating a DLQ event', async () => {
    const result = await repository.recordFailure({
      message,
      error: 'Invalid JSON',
      maxAttempts: 5,
      deadLetter,
    });

    expect(result).toEqual({
      disposition: 'retry',
      attempts: 1,
      deadLetterEventId: null,
    });
    expect(outboxCreate).not.toHaveBeenCalled();
  });

  it('creates the DLQ Outbox event on the final attempt', async () => {
    failureFindUnique.mockResolvedValue({
      attempts: 4,
      status: KafkaProcessingFailureStatus.retrying,
      deadLetterEventId: null,
    });

    const result = await repository.recordFailure({
      message,
      error: 'Invalid JSON',
      maxAttempts: 5,
      deadLetter,
    });

    expect(result).toEqual({
      disposition: 'dead_lettered',
      attempts: 5,
      deadLetterEventId: expect.any(String),
    });
    expect(outboxCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        topic: 'catalogue.recommendation.rerank.result.dlq.v2',
        messageKey: message.key,
        eventType:
          'catalogue.recommendation.rerank.result.dead-lettered',
      }),
    });
  });

  it('does not create a second DLQ event after offset redelivery', async () => {
    failureFindUnique.mockResolvedValue({
      attempts: 5,
      status: KafkaProcessingFailureStatus.dead_lettered,
      deadLetterEventId:
        '22222222-2222-4222-8222-222222222222',
    });

    const result = await repository.recordFailure({
      message,
      error: 'Invalid JSON',
      maxAttempts: 5,
      deadLetter,
    });

    expect(result).toEqual({
      disposition: 'dead_lettered',
      attempts: 5,
      deadLetterEventId:
        '22222222-2222-4222-8222-222222222222',
    });
    expect(failureUpsert).not.toHaveBeenCalled();
    expect(outboxCreate).not.toHaveBeenCalled();
  });
});
