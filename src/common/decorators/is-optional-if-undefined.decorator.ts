import { ValidateIf } from 'class-validator';

/** Omitted fields skip validation; explicit null still reaches the field validators. */
export function IsOptionalIfUndefined(): PropertyDecorator {
  return ValidateIf((_object, value: unknown) => undefined !== value);
}
