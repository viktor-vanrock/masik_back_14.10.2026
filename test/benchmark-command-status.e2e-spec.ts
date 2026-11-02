import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BENCHMARK_MESSAGE_TYPES } from '@/benchmark-service/contracts/benchmark-integration.v1';
import { Role } from '@/common/enums/role.enum';
import { KAFKA_TOPICS } from '@/kafka/kafka.constants';
import { PrismaService } from '@/prisma/prisma.service';
import { createAuthCookie } from './support/auth';
import { createE2eApplication } from './support/create-e2e-application';

describe('Benchmark asynchronous command status (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string;
  let userCookie: string;
  let userId: string;

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
    adminCookie = await createAuthCookie(app, Role.Admin);
    userCookie = await createAuthCookie(app, Role.User);
    userId = (
      await prisma.user.findUniqueOrThrow({
        where: { username: 'e2e-user' },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(async () => {
    await prisma.benchmarkCommandActor.deleteMany();
    await prisma.benchmarkCommandOutcome.deleteMany();
    await prisma.outboxMessage.deleteMany({
      where: { topic: KAFKA_TOPICS.benchmarkCommands },
    });
  });

  afterAll(async () => {
    await prisma.benchmarkCommandActor.deleteMany();
    await prisma.benchmarkCommandOutcome.deleteMany();
    await prisma.outboxMessage.deleteMany({
      where: { topic: KAFKA_TOPICS.benchmarkCommands },
    });
    await app.close();
  });

  it('exposes queued, processing and rejected transitions', async () => {
    const commandEventId = randomUUID();
    const aggregateId = randomUUID();
    await createCommand(commandEventId, aggregateId);

    const queued = await getStatus(commandEventId).expect(200);
    expect(queued.body).toMatchObject({
      commandEventId,
      commandEventType: BENCHMARK_MESSAGE_TYPES.suiteCreateRequested,
      aggregateType: 'benchmark',
      aggregateId,
      status: 'queued',
      submittedAt: expect.any(String),
      publishedAt: null,
      completedAt: null,
      reasonCode: null,
      statusCode: null,
      deletedId: null,
      message: null,
    });

    const publishedAt = new Date();
    await prisma.outboxMessage.update({
      where: { id: commandEventId },
      data: { publishedAt },
    });
    await expect(getStatus(commandEventId).expect(200)).resolves.toMatchObject({
      body: {
        status: 'processing',
        publishedAt: publishedAt.toISOString(),
      },
    });

    const completedAt = new Date();
    await prisma.benchmarkCommandOutcome.create({
      data: {
        commandEventId,
        responseEventId: randomUUID(),
        commandEventType: BENCHMARK_MESSAGE_TYPES.suiteCreateRequested,
        aggregateType: 'benchmark',
        aggregateId,
        status: 'rejected',
        reasonCode: 'BENCHMARK_NAME_CONFLICT',
        statusCode: 409,
        deletedId: aggregateId,
        message: 'Name already exists',
        occurredAt: completedAt,
        recordedAt: completedAt,
      },
    });
    await expect(getStatus(commandEventId).expect(200)).resolves.toMatchObject({
      body: {
        status: 'rejected',
        completedAt: completedAt.toISOString(),
        reasonCode: 'BENCHMARK_NAME_CONFLICT',
        statusCode: 409,
        deletedId: aggregateId,
        message: 'Name already exists',
      },
    });
  });

  it('reports an applied outcome independently of Outbox retention state', async () => {
    const commandEventId = randomUUID();
    const aggregateId = randomUUID();
    await createCommand(commandEventId, aggregateId);
    await prisma.benchmarkCommandOutcome.create({
      data: {
        commandEventId,
        responseEventId: randomUUID(),
        commandEventType: BENCHMARK_MESSAGE_TYPES.suiteCreateRequested,
        aggregateType: 'benchmark',
        aggregateId,
        status: 'applied',
        occurredAt: new Date(),
      },
    });
    await prisma.outboxMessage.delete({ where: { id: commandEventId } });

    await expect(getStatus(commandEventId).expect(200)).resolves.toMatchObject({
      body: {
        commandEventId,
        status: 'applied',
        submittedAt: null,
        publishedAt: null,
        reasonCode: null,
        statusCode: null,
        deletedId: null,
        message: null,
      },
    });
  });

  it('protects operational status and validates the command id', async () => {
    const id = randomUUID();
    await request(app.getHttpServer())
      .get(`/api/benchmark-operations/${id}`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/benchmark-operations/${id}`)
      .set('Cookie', userCookie)
      .expect(404);
    await getStatus(id).expect(404);
    await getStatus('not-a-uuid').expect(400);
  });

  it('allows a regular user to poll only an operation they initiated', async () => {
    const ownedCommandId = randomUUID();
    const foreignCommandId = randomUUID();
    await createCommand(ownedCommandId, randomUUID());
    await createCommand(foreignCommandId, randomUUID());
    await prisma.benchmarkCommandActor.create({
      data: { commandEventId: ownedCommandId, actorId: userId },
    });

    await request(app.getHttpServer())
      .get(`/api/benchmark-operations/${ownedCommandId}`)
      .set('Cookie', userCookie)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('queued'));
    await request(app.getHttpServer())
      .get(`/api/benchmark-operations/${foreignCommandId}`)
      .set('Cookie', userCookie)
      .expect(404);
  });

  async function createCommand(
    commandEventId: string,
    aggregateId: string
  ): Promise<void> {
    await prisma.outboxMessage.create({
      data: {
        id: commandEventId,
        topic: KAFKA_TOPICS.benchmarkCommands,
        messageKey: aggregateId,
        eventType: BENCHMARK_MESSAGE_TYPES.suiteCreateRequested,
        aggregateType: 'benchmark',
        aggregateId,
        deduplicationKey: `status-test:${commandEventId}`,
        payload: { eventId: commandEventId },
      },
    });
  }

  function getStatus(commandEventId: string) {
    return request(app.getHttpServer())
      .get(`/api/benchmark-operations/${commandEventId}`)
      .set('Cookie', adminCookie);
  }
});
