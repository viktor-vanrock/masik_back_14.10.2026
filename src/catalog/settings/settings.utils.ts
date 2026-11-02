import {
  BadRequestException,
  ConflictException,
  Logger,
  Type,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@/generated/prisma/client';

const logger = new Logger('SettingsUtils');

export async function validateDto<T extends object>(
  cls: Type<T>,
  payload: unknown
): Promise<T> {
  if (null === payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BadRequestException('Request body must be a JSON object');
  }

  const dto = plainToInstance(cls, payload, {
    enableImplicitConversion: false,
  });
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });

  if (errors.length > 0) {
    const messages = errors
      .map((err) =>
        err.constraints
          ? Object.values(err.constraints).join(', ')
          : `Invalid value for "${err.property}"`
      )
      .filter(Boolean);
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: messages,
    });
  }

  return dto;
}


export async function withUniqueConflict<T>(
  operation: () => Promise<T>,
  context: string
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      'P2002' === err.code
    ) {
      logger.warn(
        `Unique constraint violation in ${context}: ${JSON.stringify(err.meta)}`
      );
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message:
          'Dictionary entry with the same name or nameEn already exists (case-insensitive)',
      });
    }
    throw err;
  }
}

type DictionaryRowBase = {
  id: string;
  name: string;
  nameEn: string;
  description: string | null;
  descriptionEn: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function mapDictionaryRow(
  row: DictionaryRowBase,
  parentId: string | null,
  usageCount: number
) {
  return {
    id: row.id,
    name: row.name,
    nameEn: row.nameEn,
    description: row.description,
    descriptionEn: row.descriptionEn,
    parentId,
    usageCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
