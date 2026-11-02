import { BenchmarkValidationStatus } from '@/generated/prisma/client';

export type CatalogEntryCreateContext = {
  status: BenchmarkValidationStatus;
  authorId?: string;
  sourceConversationId?: string;
};
