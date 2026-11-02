import { IsUUID } from 'class-validator';

export class RecommendationActionDto {
  @IsUUID('4')
  recommendationId!: string;
}
