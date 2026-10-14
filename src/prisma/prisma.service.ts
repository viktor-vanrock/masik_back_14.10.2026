import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

export const DATABASE_CONNECTION_TIMEOUT_MS = 1_000;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly configService: ConfigService) {
    const connectionString =
      configService.getOrThrow<string>('db.url');

    const adapter = new PrismaPg({
      connectionString,
      // Expire pool waiters before Prisma's 2s transaction acquisition budget.
      // This cancels acquisition in pg, preventing a late BEGIN after maxWait.
      connectionTimeoutMillis: DATABASE_CONNECTION_TIMEOUT_MS,
    });

    super({
      adapter,
    });
  }

  async onModuleInit() {
    this.logger.log('Connecting to PostgreSQL via Prisma...');
    await this.$connect();
    this.logger.log('Prisma connected to PostgreSQL');
  }

  async onApplicationShutdown(): Promise<void> {
    this.logger.log('Disconnecting Prisma...');
    await this.$disconnect();
  }
}
