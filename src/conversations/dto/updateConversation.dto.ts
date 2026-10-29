import { IsBoolean, IsString, MaxLength, ValidateBy, ValidateIf } from 'class-validator';

export class UpdateConversationDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(255)
  title?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isArchived?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isPinned?: boolean;

  @ValidateBy({
    name: 'hasConversationUpdate',
    validator: {
      validate: (_value, args) => {
        const dto = args?.object as UpdateConversationDto | undefined;
        return dto !== undefined && (dto.title !== undefined || dto.isArchived !== undefined || dto.isPinned !== undefined);
      },
      defaultMessage: () => 'At least one of title, isArchived or isPinned must be provided',
    },
  })
  readonly _atLeastOne?: never;
}
