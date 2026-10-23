import { IsOptional, IsString, IsUUID } from 'class-validator';

export class StartBenchmarkCreationDto {
  @IsUUID('4')
  conversationId!: string;

  @IsOptional()
  @IsString()
  initialMessage?: string;
}
