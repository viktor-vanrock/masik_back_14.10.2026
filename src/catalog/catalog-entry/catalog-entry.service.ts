import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BenchmarkCommandOutboxService } from '@/benchmark-service/integration/benchmark-command-outbox.service';
import { BenchmarkCommandReceiptDto } from '@/benchmark-service/integration/benchmark-command-receipt.dto';
import { BenchmarkRemoteWriteService } from '@/benchmark-service/integration/benchmark-remote-write.service';
import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';
import {
  BenchmarkValidationStatus,
  ConversationIntent,
  ConversationStatus,
} from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { BenchmarkTestReadScope } from '../benchmark-test/benchmark-test-read-scope';
import { BenchmarkTestService } from '../benchmark-test/benchmark-test.service';
import { BenchmarkType } from '../benchmark-test/types';
import { CatalogTestProjectionQueryService } from '../projection/catalog-test-projection-query.service';
import { BenchmarkSearchService } from '../search/benchmark-search.service';
import { CatalogSubmissionQueryDto } from './dto/catalog-submission-query.dto';
import { ModerateCatalogEntryDto } from './dto/moderate-catalog-entry.dto';
import { SubmitCatalogEntryDto } from './dto/submit-catalog-entry.dto';

@Injectable()
export class CatalogEntryService {
  private readonly logger = new Logger(CatalogEntryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly benchmarkTestService: BenchmarkTestService,
    private readonly benchmarkSearchService: BenchmarkSearchService,
    private readonly projectionQuery: CatalogTestProjectionQueryService,
    private readonly remoteWrites: BenchmarkRemoteWriteService,
    private readonly commands: BenchmarkCommandOutboxService
  ) {}

  async submit(
    dto: SubmitCatalogEntryDto,
    authorId: string
  ): Promise<BenchmarkType | BenchmarkCommandReceiptDto> {
    const { sourceConversationId, ...testDto } = dto;

    if (sourceConversationId) {
      const source = await this.prisma.conversation.findFirst({
        where: { id: sourceConversationId, userId: authorId },
        select: { intent: true, status: true },
      });
      if (!source) {
        throw new NotFoundException(
          `Source conversation "${sourceConversationId}" was not found`
        );
      }
      if (
        ConversationIntent.create_new !== source.intent ||
        ConversationStatus.completed !== source.status
      ) {
        throw new BadRequestException(
          'A source conversation must be a completed create_new workflow'
        );
      }

      const existing = await this.prisma.catalogEntry.findUnique({
        where: { sourceConversationId },
        select: { testId: true },
      });
      if (existing) {
        throw new ConflictException(
          `Conversation "${sourceConversationId}" already produced Test "${existing.testId}"`
        );
      }
    }

    return this.benchmarkTestService.createSubmission(
      testDto,
      authorId,
      sourceConversationId
    );
  }

  async findMine(
    query: CatalogSubmissionQueryDto,
    authorId: string
  ): Promise<InfiniteDataResponseType<BenchmarkType>> {
    return this.projectionQuery.findOwnedSubmissions(query, authorId);
  }

  async findOwnById(testId: string, authorId: string): Promise<BenchmarkType> {
    const catalogEntry = await this.prisma.catalogEntry.findFirst({
      where: { testId, authorId, archivedAt: null },
    });
    if (!catalogEntry) {
      throw new NotFoundException(
        `Catalog submission with Test id "${testId}" was not found`
      );
    }

    const test = await this.projectionQuery.findById(
      testId,
      BenchmarkTestReadScope.Management
    );
    if (!test) {
      throw new NotFoundException(
        `Catalog submission with Test id "${testId}" was not found`
      );
    }

    return test;
  }

  async restoreOwn(
    testId: string,
    authorId: string
  ): Promise<BenchmarkType | BenchmarkCommandReceiptDto> {
    const catalogEntry = await this.prisma.catalogEntry.findFirst({
      where: { testId, authorId },
    });
    if (!catalogEntry) {
      throw new NotFoundException(
        `Catalog submission with Test id "${testId}" was not found`
      );
    }

    return this.remoteWrites.restoreTest(testId, true, authorId);
  }

  async moderate(
    testId: string,
    dto: ModerateCatalogEntryDto,
    reviewerId: string
  ): Promise<BenchmarkType> {
    return this.moderateProjected(testId, dto, reviewerId);
  }

  private async moderateProjected(
    testId: string,
    dto: ModerateCatalogEntryDto,
    reviewerId: string
  ): Promise<BenchmarkType> {
    const [catalogEntry, existing] = await Promise.all([
      this.prisma.catalogEntry.findUnique({
        where: { testId },
        select: { id: true },
      }),
      this.projectionQuery.findById(
        testId,
        BenchmarkTestReadScope.Management
      ),
    ]);
    if (!catalogEntry || !existing) {
      throw new NotFoundException(
        `Catalog entry for Test id "${testId}" was not found`
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await this.commands.lockTestWrites(tx, testId);
      if (BenchmarkValidationStatus.published === dto.status) {
        await this.commands.assertNoPendingTestMutation(tx, testId);
        const projection = await tx.catalogTestProjection.findFirst({
          where: { testId, deletedAt: null },
          select: { metricIds: true },
        });
        if (!projection) {
          throw new NotFoundException(`Catalog entry for Test id "${testId}" was not found`);
        }
        const assignedMetrics = await tx.metricDefinition.count({
          where: { id: { in: projection.metricIds } },
        });
        if (0 === assignedMetrics) {
          throw new BadRequestException({
            statusCode: 400,
            error: 'Bad Request',
            code: 'TEST_METRIC_REQUIRED',
            message:
              'A Test must have at least one assigned Metric before publication',
          });
        }
      }
      await tx.catalogEntry.update({
        where: { testId },
        data: {
          status: dto.status,
          rejectionReason:
            dto.status === BenchmarkValidationStatus.rejected
              ? dto.rejectionReason?.trim()
              : null,
          reviewedBy: { connect: { id: reviewerId } },
          reviewedAt: new Date(),
        },
      });
    });

    await this.syncSearchDocument(testId);
    const updated = await this.projectionQuery.findById(
      testId,
      BenchmarkTestReadScope.Management
    );
    if (!updated) {
      throw new Error(
        `Projected Test "${testId}" disappeared after Catalog moderation`
      );
    }
    return updated;
  }

  private async syncSearchDocument(testId: string): Promise<void> {
    try {
      await this.benchmarkSearchService.indexBenchmark(testId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        'Catalog moderation was saved, but the search document could not be synchronized: ' +
          `testId="${testId}", error="${message}"`
      );
    }
  }

}
