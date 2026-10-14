import 'dotenv/config';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { BenchmarkSearchModule } from '@/catalog/search/benchmark-search.module';
import { BenchmarkSearchService } from '@/catalog/search/benchmark-search.service';
import dbConfig from '@/configs/database.config';
import embeddingConfig from '@/configs/embedding.config';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [dbConfig, embeddingConfig],
      cache: true,
    }),
    PrismaModule,
    BenchmarkSearchModule,
  ],
})
class SearchReindexApplicationModule {}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    SearchReindexApplicationModule
  );

  try {
    const result = await app.get(BenchmarkSearchService).reindexAll();
    Logger.log(
      `Benchmark search reindex completed: indexed=${result.indexed}, ` +
      `failed=${result.failed}`,
      'SearchReindex'
    );

    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  Logger.error(message, 'SearchReindex');
  process.exitCode = 1;
});
