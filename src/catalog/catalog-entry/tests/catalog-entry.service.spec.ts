import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { BenchmarkCommandOutboxService } from '@/benchmark-service/integration/benchmark-command-outbox.service';
import { BenchmarkRemoteWriteService } from '@/benchmark-service/integration/benchmark-remote-write.service';
import {
  BenchmarkValidationStatus,
  ConversationIntent,
  ConversationStatus,
} from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { BenchmarkTestReadScope } from '../../benchmark-test/benchmark-test-read-scope';
import { BenchmarkTestService } from '../../benchmark-test/benchmark-test.service';
import { BenchmarkType } from '../../benchmark-test/types';
import { CatalogTestProjectionQueryService } from '../../projection/catalog-test-projection-query.service';
import { BenchmarkSearchService } from '../../search/benchmark-search.service';
import { CatalogEntryService } from '../catalog-entry.service';

describe('CatalogEntryService', () => {
  const prisma = {
    $transaction: jest.fn(),
    catalogTestProjection: { findFirst: jest.fn() },
    metricDefinition: { count: jest.fn() },
    conversation: { findFirst: jest.fn() },
    catalogEntry: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const tests = { createSubmission: jest.fn() };
  const search = { indexBenchmark: jest.fn() };
  const projections = {
    findOwnedSubmissions: jest.fn(),
    findById: jest.fn(),
  };
  const remoteWrites = { restoreTest: jest.fn() };
  const commands = {
    lockTestWrites: jest.fn(),
    assertNoPendingTestMutation: jest.fn(),
  };
  const service = new CatalogEntryService(
    prisma as unknown as PrismaService,
    tests as unknown as BenchmarkTestService,
    search as unknown as BenchmarkSearchService,
    projections as unknown as CatalogTestProjectionQueryService,
    remoteWrites as unknown as BenchmarkRemoteWriteService,
    commands as unknown as BenchmarkCommandOutboxService
  );
  const projected = {
    id: 'test-id',
    metrics: ['accuracy'],
  } as unknown as BenchmarkType;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((work) => work(prisma));
    prisma.catalogTestProjection.findFirst.mockResolvedValue({ metricIds: ['metric-id'] });
    prisma.metricDefinition.count.mockResolvedValue(1);
    search.indexBenchmark.mockResolvedValue(undefined);
  });

  it('delegates a submission with the authenticated author', async () => {
    tests.createSubmission.mockResolvedValue(projected);
    const dto = {
      suiteId: '11111111-1111-4111-8111-111111111111',
      name: 'Тест',
      nameEn: 'Test',
      description: 'Description',
    };

    await expect(service.submit(dto, 'author-id')).resolves.toBe(projected);
    expect(tests.createSubmission).toHaveBeenCalledWith(
      dto,
      'author-id',
      undefined
    );
  });

  it('accepts only a completed owned create conversation as source', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      intent: ConversationIntent.create_new,
      status: ConversationStatus.completed,
    });
    prisma.catalogEntry.findUnique.mockResolvedValue(null);
    tests.createSubmission.mockResolvedValue(projected);
    const sourceConversationId = '10000000-0000-4000-8000-000000000001';

    await service.submit(
      {
        suiteId: '11111111-1111-4111-8111-111111111111',
        name: 'Тест',
        nameEn: 'Test',
        description: 'Description',
        sourceConversationId,
      },
      'author-id'
    );
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: sourceConversationId, userId: 'author-id' },
      select: { intent: true, status: true },
    });

    prisma.conversation.findFirst.mockResolvedValue(null);
    await expect(
      service.submit(
        {
          suiteId: '11111111-1111-4111-8111-111111111111',
          name: 'Other',
          nameEn: 'Other',
          description: 'Description',
          sourceConversationId,
        },
        'author-id'
      )
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects incomplete or already consumed source conversations', async () => {
    const sourceConversationId = '10000000-0000-4000-8000-000000000001';
    prisma.conversation.findFirst.mockResolvedValue({
      intent: ConversationIntent.find_existing,
      status: ConversationStatus.awaiting_choice,
    });
    await expect(
      service.submit(
        {
          suiteId: '11111111-1111-4111-8111-111111111111',
          name: 'Test',
          nameEn: 'Test',
          description: 'Description',
          sourceConversationId,
        },
        'author-id'
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.conversation.findFirst.mockResolvedValue({
      intent: ConversationIntent.create_new,
      status: ConversationStatus.completed,
    });
    prisma.catalogEntry.findUnique.mockResolvedValue({ testId: 'existing' });
    await expect(
      service.submit(
        {
          suiteId: '11111111-1111-4111-8111-111111111111',
          name: 'Test',
          nameEn: 'Test',
          description: 'Description',
          sourceConversationId,
        },
        'author-id'
      )
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('serves owned submissions only from projections', async () => {
    const page = { data: [projected], total: 1 };
    projections.findOwnedSubmissions.mockResolvedValue(page);
    const query = {
      page: 1,
      limit: 20,
      status: BenchmarkValidationStatus.validation,
    };

    await expect(service.findMine(query, 'author-id')).resolves.toBe(page);
    expect(projections.findOwnedSubmissions).toHaveBeenCalledWith(
      query,
      'author-id'
    );
  });

  it('does not reveal missing or foreign submissions', async () => {
    prisma.catalogEntry.findFirst.mockResolvedValue(null);
    await expect(
      service.findOwnById('test-id', 'author-id')
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.restoreOwn('test-id', 'author-id')
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reads an owned submission projection with management visibility', async () => {
    prisma.catalogEntry.findFirst.mockResolvedValue({ id: 'entry-id' });
    projections.findById.mockResolvedValue(projected);

    await expect(
      service.findOwnById('test-id', 'author-id')
    ).resolves.toBe(projected);
    expect(projections.findById).toHaveBeenCalledWith(
      'test-id',
      BenchmarkTestReadScope.Management
    );
  });

  it('queues owner restore through the Benchmark service adapter', async () => {
    const receipt = { status: 'queued', operationId: 'operation-id' };
    prisma.catalogEntry.findFirst.mockResolvedValue({ id: 'entry-id' });
    remoteWrites.restoreTest.mockResolvedValue(receipt);

    await expect(service.restoreOwn('test-id', 'author-id')).resolves.toBe(
      receipt
    );
    expect(remoteWrites.restoreTest).toHaveBeenCalledWith(
      'test-id',
      true,
      'author-id'
    );
  });

  it('publishes only a projected Test with at least one Metric', async () => {
    prisma.catalogEntry.findUnique.mockResolvedValue({ id: 'entry-id' });
    projections.findById
      .mockResolvedValueOnce(projected)
      .mockResolvedValueOnce({
        ...projected,
        validationStatus: BenchmarkValidationStatus.published,
      });

    await service.moderate(
      'test-id',
      { status: BenchmarkValidationStatus.published },
      'reviewer-id'
    );
    expect(prisma.catalogEntry.update).toHaveBeenCalledWith({
      where: { testId: 'test-id' },
      data: expect.objectContaining({
        status: BenchmarkValidationStatus.published,
        rejectionReason: null,
        reviewedBy: { connect: { id: 'reviewer-id' } },
        reviewedAt: expect.any(Date),
      }),
    });
    expect(search.indexBenchmark).toHaveBeenCalledWith('test-id');
  });

  it('rejects publication without a Metric and trims rejection reasons', async () => {
    prisma.metricDefinition.count.mockResolvedValue(0);
    prisma.catalogEntry.findUnique.mockResolvedValue({ id: 'entry-id' });
    projections.findById.mockResolvedValue({ ...projected, metrics: [] });
    const publicationError = await service
      .moderate(
        'test-id',
        { status: BenchmarkValidationStatus.published },
        'reviewer-id'
      )
      .catch((error: unknown) => error);
    expect(publicationError).toBeInstanceOf(BadRequestException);
    expect((publicationError as BadRequestException).getResponse()).toMatchObject({
      statusCode: 400,
      code: 'TEST_METRIC_REQUIRED',
    });

    projections.findById
      .mockResolvedValueOnce({ ...projected, metrics: [] })
      .mockResolvedValueOnce(projected);
    await service.moderate(
      'test-id',
      {
        status: BenchmarkValidationStatus.rejected,
        rejectionReason: '  incomplete fields  ',
      },
      'reviewer-id'
    );
    expect(prisma.catalogEntry.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rejectionReason: 'incomplete fields' }),
      })
    );
  });

  it('keeps a saved moderation decision if search indexing fails', async () => {
    prisma.catalogEntry.findUnique.mockResolvedValue({ id: 'entry-id' });
    projections.findById.mockResolvedValue(projected);
    search.indexBenchmark.mockRejectedValue(new Error('search unavailable'));

    await expect(
      service.moderate(
        'test-id',
        {
          status: BenchmarkValidationStatus.rejected,
          rejectionReason: 'invalid',
        },
        'reviewer-id'
      )
    ).resolves.toBe(projected);
  });
});
