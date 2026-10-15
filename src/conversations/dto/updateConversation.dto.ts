import { IsBoolean, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class UpdateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;

  /** Хотя бы одно поле должно быть заполнено. */
  @ValidateIf((o) => o.title === undefined && o.isArchived === undefined)
  @IsString({ message: 'At least one of title or isArchived must be provided' })
  readonly _atLeastOne?: never;
}
