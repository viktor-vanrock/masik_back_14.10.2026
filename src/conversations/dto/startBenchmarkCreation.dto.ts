import { IsUUID } from 'class-validator';

export class StartBenchmarkCreationDto {
  @IsUUID('4')
  conversationId!: string;
}
