import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';

export function contactIdempotencyKey(value: string): string {
  if (!isUUID(value, '4')) throw new BadRequestException('Idempotency-Key must be a UUID v4');
  return value.toLowerCase();
}
