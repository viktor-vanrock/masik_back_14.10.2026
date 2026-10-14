import { IsUUID } from 'class-validator';

export class RegenerateHypothesesDto {
  @IsUUID('4')
  conversationId!: string;
}
