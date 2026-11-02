import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateGenerationDto {
  @IsUUID('4')
  conversationId!: string;

  @IsString()
  @MaxLength(160)
  testId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  hypotheses!: string[];
}
