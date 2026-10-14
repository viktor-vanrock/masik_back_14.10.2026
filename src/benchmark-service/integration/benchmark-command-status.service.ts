import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@/common/enums/role.enum';
import { KAFKA_TOPICS } from '@/kafka/kafka.constants';
import { PrismaService } from '@/prisma/prisma.service';
import {
  BenchmarkCommandStatus,
  BenchmarkCommandStatusDto,
} from './benchmark-command-status.dto';
import type { RequestUser } from '@/common/types/request.type';

@Injectable()
export class BenchmarkCommandStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async get(
    commandEventId: string,
    requester: RequestUser
  ): Promise<BenchmarkCommandStatusDto> {
    const [command, outcome, actor] = await this.prisma.$transaction([
      this.prisma.outboxMessage.findFirst({
        where: {
          id: commandEventId,
          topic: KAFKA_TOPICS.benchmarkCommands,
        },
        select: {
          id: true,
          eventType: true,
          aggregateType: true,
          aggregateId: true,
          createdAt: true,
          publishedAt: true,
        },
      }),
      this.prisma.benchmarkCommandOutcome.findUnique({
        where: { commandEventId },
      }),
      this.prisma.benchmarkCommandActor.findUnique({
        where: { commandEventId },
        select: { actorId: true },
      }),
    ]);

    if (!command && !outcome) {
      this.notFound(commandEventId);
    }
    if (Role.User === requester.role && actor?.actorId !== requester.id) {
      this.notFound(commandEventId);
    }

    return {
      commandEventId,
      commandEventType: command?.eventType ?? outcome!.commandEventType,
      aggregateType: this.aggregateType(
        command?.aggregateType ?? outcome!.aggregateType
      ),
      aggregateId: command?.aggregateId ?? outcome!.aggregateId,
      status: this.status(command?.publishedAt ?? null, outcome?.status),
      submittedAt: command?.createdAt ?? null,
      publishedAt: command?.publishedAt ?? null,
      completedAt: outcome?.recordedAt ?? null,
      reasonCode: outcome?.reasonCode ?? null,
      statusCode: this.statusCode(outcome?.statusCode),
      deletedId: outcome?.deletedId ?? null,
      message: outcome?.message ?? null,
    };
  }

  private notFound(commandEventId: string): never {
    throw new NotFoundException(
      `Benchmark command "${commandEventId}" was not found`
    );
  }

  private aggregateType(value: string): 'benchmark' | 'test' {
    if ('benchmark' === value || 'test' === value) return value;
    throw new Error(`Unsupported Benchmark command aggregate type: "${value}"`);
  }

  private status(
    publishedAt: Date | null,
    outcomeStatus: string | undefined
  ): BenchmarkCommandStatus {
    if ('applied' === outcomeStatus || 'rejected' === outcomeStatus) {
      return outcomeStatus;
    }
    if (outcomeStatus) {
      throw new Error(`Unsupported Benchmark command outcome: "${outcomeStatus}"`);
    }
    return publishedAt ? 'processing' : 'queued';
  }

  private statusCode(value: number | null | undefined): 400 | 404 | 409 | null {
    if (undefined === value || null === value) return null;
    if (400 === value || 404 === value || 409 === value) return value;
    throw new Error(`Unsupported Benchmark rejection status code: "${value}"`);
  }
}
