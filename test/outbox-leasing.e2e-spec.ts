import { randomUUID } from 'node:crypto';
import { OutboxRepository } from '@/kafka/outbox/outbox.repository';
import { PrismaService } from '@/prisma/prisma.service';
import { createE2eApplication } from './support/create-e2e-application';
import type { INestApplication } from '@nestjs/common';

describe('Outbox publish leases (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let firstPublisher: OutboxRepository;
  let secondPublisher: OutboxRepository;
  const topic = 'test.outbox-leasing.v1';

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
    firstPublisher = new OutboxRepository(prisma);
    secondPublisher = new OutboxRepository(prisma);
  });

  beforeEach(async () => {
    // findPending intentionally leases messages across every topic. Isolate this
    // repository-level test from Outbox rows produced by earlier e2e suites.
    await prisma.outboxMessage.deleteMany();
  });

  afterAll(async () => {
    await prisma.outboxMessage.deleteMany();
    await app.close();
  });

  it('lets exactly one replica claim and acknowledge a pending row', async () => {
    const id = randomUUID();
    await prisma.outboxMessage.create({
      data: {
        id,
        topic,
        messageKey: id,
        eventType: 'test.event.v1',
        aggregateType: 'test',
        aggregateId: id,
        payload: { eventId: id },
      },
    });
    const availableBefore = new Date();

    const [first, second] = await Promise.all([
      firstPublisher.findPending({ availableBefore, limit: 10 }),
      secondPublisher.findPending({ availableBefore, limit: 10 }),
    ]);

    expect(first.length + second.length).toBe(1);
    const claimed = [...first, ...second][0];
    expect(claimed).toMatchObject({
      id,
      claimedAt: availableBefore,
      claimToken: expect.any(String),
    });
    await expect(
      secondPublisher.markPublished({
        id,
        claimToken: randomUUID(),
        publishedAt: new Date(),
      })
    ).resolves.toBe(false);
    await expect(
      firstPublisher.markPublished({
        id,
        claimToken: claimed.claimToken as string,
        publishedAt: new Date(),
      })
    ).resolves.toBe(true);
    await expect(
      prisma.outboxMessage.findUniqueOrThrow({ where: { id } })
    ).resolves.toMatchObject({
      publishedAt: expect.any(Date),
      claimedAt: null,
      claimToken: null,
    });
  });

  it('takes over an expired lease but leaves an active lease alone', async () => {
    const expiredId = randomUUID();
    const activeId = randomUUID();
    const oldToken = randomUUID();
    const now = new Date();
    await prisma.outboxMessage.createMany({
      data: [
        {
          id: expiredId,
          topic,
          messageKey: expiredId,
          eventType: 'test.event.v1',
          aggregateType: 'test',
          aggregateId: expiredId,
          payload: { eventId: expiredId },
          availableAt: new Date(now.getTime() - 1_000),
          claimedAt: new Date(now.getTime() - 31_000),
          claimToken: oldToken,
        },
        {
          id: activeId,
          topic,
          messageKey: activeId,
          eventType: 'test.event.v1',
          aggregateType: 'test',
          aggregateId: activeId,
          payload: { eventId: activeId },
          availableAt: new Date(now.getTime() - 1_000),
          claimedAt: new Date(now.getTime() - 29_000),
          claimToken: randomUUID(),
        },
      ],
    });

    const claimed = await firstPublisher.findPending({
      availableBefore: now,
      limit: 10,
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0].id).toBe(expiredId);
    expect(claimed[0].claimToken).not.toBe(oldToken);
  });

  it('never leases a later message for the same Kafka key before its predecessor', async () => {
    const firstId = '11111111-1111-4111-8111-111111111111';
    const secondId = '22222222-2222-4222-8222-222222222222';
    const otherId = '33333333-3333-4333-8333-333333333333';
    const sharedKey = 'ordered-aggregate';
    const now = new Date('2026-09-13T10:00:03.000Z');
    await prisma.outboxMessage.createMany({
      data: [
        {
          id: firstId,
          topic,
          messageKey: sharedKey,
          eventType: 'test.created.v1',
          aggregateType: 'test',
          aggregateId: sharedKey,
          payload: { sequence: 1 },
          availableAt: new Date('2026-09-13T10:00:00.000Z'),
          createdAt: new Date('2026-09-13T10:00:00.000Z'),
        },
        {
          id: secondId,
          topic,
          messageKey: sharedKey,
          eventType: 'test.updated.v1',
          aggregateType: 'test',
          aggregateId: sharedKey,
          payload: { sequence: 2 },
          availableAt: new Date('2026-09-13T10:00:01.000Z'),
          createdAt: new Date('2026-09-13T10:00:01.000Z'),
        },
        {
          id: otherId,
          topic,
          messageKey: 'independent-aggregate',
          eventType: 'test.created.v1',
          aggregateType: 'test',
          aggregateId: 'independent-aggregate',
          payload: { sequence: 1 },
          availableAt: new Date('2026-09-13T10:00:02.000Z'),
          createdAt: new Date('2026-09-13T10:00:02.000Z'),
        },
      ],
    });

    const claims = (
      await Promise.all([
        firstPublisher.findPending({ availableBefore: now, limit: 10 }),
        secondPublisher.findPending({ availableBefore: now, limit: 10 }),
      ])
    ).flat();

    expect(claims.map(({ id }) => id).sort()).toEqual(
      [firstId, otherId].sort()
    );
    expect(claims.some(({ id }) => id === secondId)).toBe(false);
    const first = claims.find(({ id }) => id === firstId)!;
    await firstPublisher.markPublished({
      id: first.id,
      claimToken: first.claimToken!,
      publishedAt: now,
    });

    await expect(
      firstPublisher.findPending({
        availableBefore: new Date(now.getTime() + 1),
        limit: 10,
      })
    ).resolves.toEqual([
      expect.objectContaining({ id: secondId, claimToken: expect.any(String) }),
    ]);
  });
});
