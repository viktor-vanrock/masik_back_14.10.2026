import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class StartBenchmarkCreationDto {
  @IsUUID('4')
  conversationId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  initialMessage?: string;
}
