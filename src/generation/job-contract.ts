import { HttpException } from '@nestjs/common';

export const apiError = (status: number, code: string, message: string) =>
  new HttpException({ error: { code, message } }, status);

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && 'object' === typeof value) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
