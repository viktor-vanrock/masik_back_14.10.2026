import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import { Role } from '@/common/enums/role.enum';
import {
  MessageKind,
  MessageRole,
  RecommendationRequestStatus,
} from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { createE2eApplication } from './support/create-e2e-application';

describe('Conversation ownership (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
  });

  beforeEach(async () => {
    await prisma.conversation.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.conversation.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

  async function actor(suffix: string, role: Role = Role.User) {
    const user = await prisma.user.create({
      data: {
        username: `conversation-${suffix}`,
        email: `conversation-${suffix}@example.test`,
        password: 'not-used-by-test',
        role,
      },
    });
    const token = await jwt.signAsync({
      sub: user.id,
      username: user.username,
      role,
    });
    return {
      ...user,
      cookie: `${AUTH_COOKIE_NAME}=${token}`,
    };
  }

  it('requires authentication for list and detail', async () => {
    const owner = await actor('private');
    const conversation = await prisma.conversation.create({
      data: { userId: owner.id },
    });

    await request(app.getHttpServer()).get('/api/conversations').expect(401);
    await request(app.getHttpServer())
      .get(`/api/conversations/${conversation.id}`)
      .expect(401);
  });

  it('returns only the current user conversations and hides a foreign UUID', async () => {
    const owner = await actor('owner');
    const stranger = await actor('stranger');
    const own = await prisma.conversation.create({
      data: { userId: owner.id },
    });
    const foreign = await prisma.conversation.create({
      data: { userId: stranger.id },
    });
    await prisma.message.create({
      data: {
        conversationId: own.id,
        role: MessageRole.user,
        kind: MessageKind.text,
        content: 'private message',
      },
    });

    const list = await request(app.getHttpServer())
      .get('/api/conversations')
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(list.body).toMatchObject({
      total: 1,
      data: [{ id: own.id, userId: owner.id }],
    });

    const detail = await request(app.getHttpServer())
      .get(`/api/conversations/${own.id}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(detail.body).toMatchObject({
      id: own.id,
      userId: owner.id,
      messages: [{ content: 'private message' }],
    });

    await request(app.getHttpServer())
      .get(`/api/conversations/${foreign.id}`)
      .set('Cookie', owner.cookie)
      .expect(404);
  });

  it.each([Role.Admin, Role.SuperUser])(
    'limits %s to their own conversations',
    async (role) => {
      const owner = await actor(`owner-${role}`);
      const staff = await actor(`staff-${role}`, role);
      const foreign = await prisma.conversation.create({
        data: { userId: owner.id },
      });
      const own = await prisma.conversation.create({
        data: { userId: staff.id },
      });

      const list = await request(app.getHttpServer())
        .get('/api/conversations')
        .set('Cookie', staff.cookie)
        .expect(200);
      expect(list.body).toMatchObject({
        total: 1,
        data: [{ id: own.id, userId: staff.id }],
      });

      await request(app.getHttpServer())
        .get(`/api/conversations/${own.id}`)
        .set('Cookie', staff.cookie)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/conversations/${foreign.id}`)
        .set('Cookie', staff.cookie)
        .expect(404);
    }
  );

  it('exposes recommendation targets only as testId and normalizes legacy snapshots', async () => {
    const owner = await actor('recommendation-contract');
    const conversation = await prisma.conversation.create({
      data: { userId: owner.id },
    });
    const testId = 'recommended-test-id';

    await prisma.recommendation.create({
      data: { conversationId: conversation.id, testId },
    });
    await prisma.recommendationRequest.create({
      data: {
        conversationId: conversation.id,
        query: 'Find a test',
        status: RecommendationRequestStatus.completed,
        resultPayload: [
          {
            benchmarkId: testId,
            rank: 1,
            score: 0.9,
            rerankScore: null,
            sourceUpdatedAt: '2026-09-07T10:00:00.000Z',
          },
        ],
        completedAt: new Date('2026-09-07T10:01:00.000Z'),
      },
    });

    const response = await request(app.getHttpServer())
      .get(`/api/conversations/${conversation.id}`)
      .set('Cookie', owner.cookie)
      .expect(200);

    expect(response.body.recommendations).toEqual([
      expect.objectContaining({ testId }),
    ]);
    expect(response.body.recommendations[0]).not.toHaveProperty('benchmarkId');
    expect(response.body.recommendationRequests[0].resultPayload).toEqual([
      expect.objectContaining({ testId }),
    ]);
    expect(
      response.body.recommendationRequests[0].resultPayload[0]
    ).not.toHaveProperty('benchmarkId');
  });
});
