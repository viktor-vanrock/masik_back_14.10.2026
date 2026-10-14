import { INestApplication } from '@nestjs/common';
import { ConversationsService } from '@/conversations/conversations.service';
import {
  ConversationIntent,
  ConversationStatus,
  MessageKind,
  RecommendationStatus,
} from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { RecommendationsService } from '@/recommendations/recommendations.service';
import { createE2eApplication } from './support/create-e2e-application';

describe('Conversation actions idempotency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let conversations: ConversationsService;
  let recommendations: RecommendationsService;

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
    conversations = app.get(ConversationsService);
    recommendations = app.get(RecommendationsService);
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

  async function seedRecommendation() {
    const owner = await prisma.user.create({
      data: {
        username: 'idempotency-owner',
        email: 'idempotency-owner@example.test',
        password: 'not-used-by-this-contract-test',
      },
    });
    const conversation = await prisma.conversation.create({
      data: {
        userId: owner.id,
        intent: ConversationIntent.find_existing,
        status: ConversationStatus.awaiting_choice,
      },
    });
    const recommendation = await prisma.recommendation.create({
      data: {
        conversationId: conversation.id,
        testId: 'recommended-test-id',
      },
    });
    return { owner, conversation, recommendation };
  }

  it('applies duplicate concurrent selection exactly once', async () => {
    const seeded = await seedRecommendation();
    const select = async () => {
      const update = await recommendations.updateStatus({
        id: seeded.recommendation.id,
        status: RecommendationStatus.selected,
      });
      await conversations.acceptRecommendation(
        seeded.conversation.id,
        seeded.recommendation.testId
      );
      return update;
    };

    const results = await Promise.all([select(), select()]);

    expect(results.map((result) => result.transitioned).sort()).toEqual([
      false,
      true,
    ]);
    await expect(
      prisma.message.count({
        where: {
          conversationId: seeded.conversation.id,
          kind: MessageKind.recommendation_selected,
        },
      })
    ).resolves.toBe(1);
    await expect(
      prisma.conversation.findUniqueOrThrow({
        where: { id: seeded.conversation.id },
        select: { status: true },
      })
    ).resolves.toEqual({ status: ConversationStatus.completed });
  });

  it('applies duplicate concurrent rejection and starts Interviewer once', async () => {
    const seeded = await seedRecommendation();
    const reject = async () => {
      const update = await recommendations.updateStatus({
        id: seeded.recommendation.id,
        status: RecommendationStatus.rejected,
      });
      await conversations.startBenchmarkCreation({
        userId: seeded.owner.id,
        conversationId: seeded.conversation.id,
        rejectedTestId: seeded.recommendation.testId,
        onAgent: jest.fn(),
      });
      return update;
    };

    const results = await Promise.all([reject(), reject()]);

    expect(results.map((result) => result.transitioned).sort()).toEqual([
      false,
      true,
    ]);
    await expect(
      prisma.message.count({
        where: {
          conversationId: seeded.conversation.id,
          kind: MessageKind.recommendation_rejected,
        },
      })
    ).resolves.toBe(1);
    await expect(
      prisma.conversation.findUniqueOrThrow({
        where: { id: seeded.conversation.id },
        select: { intent: true, status: true },
      })
    ).resolves.toEqual({
      intent: ConversationIntent.create_new,
      status: ConversationStatus.active,
    });
  });

  it('lets exactly one of conflicting concurrent actions win', async () => {
    const seeded = await seedRecommendation();

    const outcomes = await Promise.allSettled([
      recommendations.updateStatus({
        id: seeded.recommendation.id,
        status: RecommendationStatus.selected,
      }),
      recommendations.updateStatus({
        id: seeded.recommendation.id,
        status: RecommendationStatus.rejected,
      }),
    ]);

    expect(outcomes.filter((item) => 'fulfilled' === item.status)).toHaveLength(
      1
    );
    expect(outcomes.filter((item) => 'rejected' === item.status)).toHaveLength(
      1
    );
    const stored = await prisma.recommendation.findUniqueOrThrow({
      where: { id: seeded.recommendation.id },
    });
    expect([
      RecommendationStatus.selected,
      RecommendationStatus.rejected,
    ]).toContain(stored.status);
  });
});
