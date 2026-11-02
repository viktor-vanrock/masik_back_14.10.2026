import { IsInt, IsUUID, Min } from 'class-validator';

export class RetryResponseDto {
  @IsUUID('4')
  conversationId!: string;

  @IsUUID('4')
  userMessageId!: string;

  @IsInt()
  @Min(1)
  expectedAttempt!: number;
}
