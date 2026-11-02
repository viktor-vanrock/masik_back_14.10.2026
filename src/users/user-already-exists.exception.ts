import { ConflictException, HttpStatus } from '@nestjs/common';

export class UserAlreadyExistsException extends ConflictException {
  constructor(field: 'email' | 'username') {
    super({
      statusCode: HttpStatus.CONFLICT,
      code: 'email' === field ? 'EMAIL_ALREADY_EXISTS' : 'USERNAME_ALREADY_EXISTS',
      message: 'email' === field
        ? 'Пользователь с таким email уже зарегистрирован.'
        : 'Это имя пользователя уже занято.',
      field,
    });
  }
}
