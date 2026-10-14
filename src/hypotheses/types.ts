import { Prisma } from '@/generated/prisma/client';

export const hypothesisGenerationFullInclude = {
  hypotheses: {
    orderBy: {
      createdAt: 'asc',
    },
  },
} satisfies Prisma.HypothesisGenerationInclude;

export type HypothesisGenerationWithHypotheses =
  Prisma.HypothesisGenerationGetPayload<{
    include: typeof hypothesisGenerationFullInclude;
  }>;

export type CreateGenerationParams = {
  conversationId: string;
  testId: string;
  hypotheses: string[];
};
