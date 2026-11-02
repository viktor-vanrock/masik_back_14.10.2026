import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DictionaryValidator } from '@/catalog/benchmark-test/dictionary-validator';
import { PrismaModule } from '@/prisma/prisma.module';
import { BenchmarkCommandOutboxService } from './benchmark-command-outbox.service';
import { BenchmarkCommandStatusController } from './benchmark-command-status.controller';
import { BenchmarkCommandStatusService } from './benchmark-command-status.service';
import { BenchmarkRemoteWriteService } from './benchmark-remote-write.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [BenchmarkCommandStatusController],
  providers: [
    BenchmarkCommandOutboxService,
    BenchmarkCommandStatusService,
    BenchmarkRemoteWriteService,
    DictionaryValidator,
  ],
  exports: [
    BenchmarkCommandOutboxService,
    BenchmarkCommandStatusService,
    BenchmarkRemoteWriteService,
    DictionaryValidator,
  ],
})
export class BenchmarkIntegrationModule {}
