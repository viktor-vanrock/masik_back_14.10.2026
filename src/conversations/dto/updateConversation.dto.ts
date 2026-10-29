import { IsBoolean, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class UpdateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isPinned?: boolean;

  /** Хотя бы одно поле должно быть заполнено. */
  @ValidateIf((o) => o.title === undefined && o.isArchived === undefined && o.isPinned === undefined)
  @IsString({ message: 'At least one of title, isArchived or isPinned must be provided' })
  readonly _atLeastOne?: never;
}
