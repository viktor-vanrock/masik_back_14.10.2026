import { Transform } from 'class-transformer';
import {
  IsArray,
  IsString,
  ValidationOptions,
} from 'class-validator';

export function IsRepeatedStringQuery(
  validationOptions?: ValidationOptions
) {
  return function (object: object, propertyName: string) {
    Transform(({ value }) => {
      if (value === undefined || null === value || '' === value) {
        return undefined;
      }

      if (Array.isArray(value)) {
        return value.map(String);
      }

      return [String(value)];
    })(object, propertyName);

    IsArray(validationOptions)(object, propertyName);
    IsString({ each: true })(object, propertyName);
  };
}
