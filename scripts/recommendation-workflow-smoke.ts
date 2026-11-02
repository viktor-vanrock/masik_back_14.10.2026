import 'dotenv/config';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { BenchmarkSearchService } from '@/catalog/search/benchmark-search.service';
import { BenchmarkValidationStatus } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { RecommendationRequestsService } from '@/recommendations/recommendation-requests.service';

const CONVERSATION_ID = '77777777-7777-4777-8777-777777777777';
const SUITE_ID = 'recommendation-smoke-suite';
const MEDICAL_TEST_ID = 'recommendation-smoke-medical';
const CODE_TEST_ID = 'recommendation-smoke-code-generation';

const main = async (): Promise<void> => {
  const log = (message: string): void => {
    process.stdout.write(`[RecommendationSmoke] ${message}\n`);
  };
  let app: INestApplicationContext | undefined;
  let prisma: PrismaService | undefined;

  try {
    log('1/6 Запускаем Catalogue с настроенными mock/HTTP model providers');
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['log', 'warn', 'error'],
    });
    const db = app.get(PrismaService);
    prisma = db;

    log('2/6 Создаём две временные опубликованные карточки');
    await cleanup(db);
    await db.benchmark.create({
      data: {
        id: SUITE_ID,
        name: 'Recommendation smoke suite',
        nameEn: 'Recommendation smoke suite',
        description: 'Temporary recommendation workflow data',
        tests: {
          create: [
            {
              id: MEDICAL_TEST_ID,
              name: 'Медицинская диагностика',
              nameEn: 'Medical diagnostics',
              description:
                'Медицинские вопросы, диагностика и анализ снимков',
              taskDescription: 'Отвечать на медицинские вопросы',
              catalogEntry: {
                create: { status: BenchmarkValidationStatus.published },
              },
            },
            {
              id: CODE_TEST_ID,
              name: 'Генерация кода',
              nameEn: 'Code generation',
              description: 'Написание и исправление программного кода',
              taskDescription: 'Сгенерировать код программы',
              catalogEntry: {
                create: { status: BenchmarkValidationStatus.published },
              },
            },
          ],
        },
      },
    });
    await db.conversation.create({
      data: {
        id: CONVERSATION_ID,
        userId: 'recommendation-smoke-user',
        intent: 'find_existing',
      },
    });

    log('3/6 Строим документы и сохраняем embeddings в pgvector');
    const search = app.get(BenchmarkSearchService);
    await search.indexBenchmark(MEDICAL_TEST_ID);
    await search.indexBenchmark(CODE_TEST_ID);

    log('4/6 Сохраняем pending-запрос и выполняем полный workflow');
    const recommendations = app.get(RecommendationRequestsService);
    const request = await recommendations.createPending({
      conversationId: CONVERSATION_ID,
      query: 'медицинская диагностика',
      topK: 1,
    });
    const notification = await recommendations.execute(request);
    if ('completed' !== notification.status) {
      throw new Error(
        `Recommendation request failed: ${notification.errorCode}`
      );
    }

    log('5/6 Проверяем PostgreSQL result и выбранную карточку');
    const completed = await db.recommendationRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    const selected = await db.recommendation.findFirst({
      where: { conversationId: CONVERSATION_ID },
    });
    if (!selected || MEDICAL_TEST_ID !== selected.testId) {
      throw new Error(
        `Expected ${MEDICAL_TEST_ID}, got ${selected?.testId ?? 'nothing'}`
      );
    }

    log(JSON.stringify({
      requestId: completed.id,
      status: completed.status,
      retrievalVersion: completed.retrievalVersion,
      rerankerVersion: completed.rerankerVersion,
      candidates: completed.candidatePayload,
      result: completed.resultPayload,
      recommendationId: selected.id,
    }, null, 2));
    log('6/6 SUCCESS: embedder -> pgvector -> reranker завершён без Kafka');
  } finally {
    if (prisma) await cleanup(prisma).catch(() => undefined);
    await app?.close().catch(() => undefined);
  }
};

const cleanup = async (prisma: PrismaService): Promise<void> => {
  await prisma.conversation.deleteMany({ where: { id: CONVERSATION_ID } });
  await prisma.benchmark.deleteMany({ where: { id: SUITE_ID } });
};

void main().catch((error: unknown) => {
  const message = error instanceof Error
    ? error.stack ?? error.message
    : String(error);
  process.stderr.write(`[RecommendationSmoke] ${message}\n`);
  process.exitCode = 1;
});
