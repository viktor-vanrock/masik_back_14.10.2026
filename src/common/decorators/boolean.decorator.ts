import { Transform } from 'class-transformer';
import { registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';

export function IsBoolean(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    Transform(({ value }) => {
      if ('true' === value) return true;
      if ('false' === value) return false;
      return value;
    })(object, propertyName);
    registerDecorator({
      name: 'isBoolean',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any) {
          return 'boolean' === typeof value;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be boolean value ("true" or "false")`;
        },
      },
    });
  };
}
