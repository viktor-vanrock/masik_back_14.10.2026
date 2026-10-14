import { createHash, randomUUID } from 'node:crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingEnvType } from '@/configs/types';
import { EmbeddingVector } from './types';

type EmbeddingResponseItem = Readonly<{
  index?: unknown;
  embedding?: unknown;
}>;

@Injectable()
export class EmbeddingService {
  private readonly config: EmbeddingEnvType;
  private token: { value: string; expiresAt: number } | null = null;
  private tokenRequest: Promise<string> | null = null;

  constructor(configService: ConfigService) {
    this.config = configService.getOrThrow<EmbeddingEnvType>('embedding');
  }

  get specId(): string {
    return this.config.specId;
  }

  get batchSize(): number {
    return this.config.batchSize;
  }

  async embedQuery(input: string, signal?: AbortSignal): Promise<EmbeddingVector> {
    const [result] = await this.embedMany([input], signal);
    if (!result) {
      throw new ServiceUnavailableException(
        'Embedding provider returned no query embedding'
      );
    }
    return result;
  }

  async embedDocument(input: string): Promise<EmbeddingVector> {
    const [result] = await this.embedDocuments([input]);
    if (!result) {
      throw new ServiceUnavailableException(
        'Embedding provider returned no document embedding'
      );
    }
    return result;
  }

  embedDocuments(
    inputs: readonly string[]
  ): Promise<readonly EmbeddingVector[]> {
    return this.embedMany(inputs);
  }

  private async embedMany(
    inputs: readonly string[],
    signal?: AbortSignal
  ): Promise<readonly EmbeddingVector[]> {
    signal?.throwIfAborted();
    if (0 === inputs.length) return [];

    const normalizedInputs = inputs.map((input, index) => {
      const normalized = input.trim();
      if (!normalized) {
        throw new Error(`Embedding input[${index}] must not be empty`);
      }
      return normalized;
    });

    if ('mock' === this.config.provider) {
      return normalizedInputs.map((input) => ({
        values: this.mockVector(input, this.config.dimensions),
        dimensions: this.config.dimensions,
        model: this.config.model,
      }));
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      signal?.throwIfAborted();
      try {
        return await this.embedGigaChatInputs(normalizedInputs, signal);
      } catch (error: unknown) {
        signal?.throwIfAborted();
        lastError = error;
        if (attempt === this.config.maxRetries || !this.isRetryable(error)) {
          break;
        }
        await this.delay(this.config.retryDelayMs * 2 ** attempt, signal);
      }
    }

    const message = lastError instanceof Error
      ? lastError.message
      : String(lastError);
    throw new ServiceUnavailableException(
      `Embedding provider is unavailable: ${message}`
    );
  }

  private async fetchEmbeddings(
    inputs: readonly string[],
    signal?: AbortSignal,
    refreshUnauthorized = true
  ): Promise<readonly EmbeddingVector[]> {
    const accessToken = await this.getAccessToken(signal);
    const { status, payload } = await this.requestJson(this.config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        input: inputs,
      }),
    }, signal);
    signal?.throwIfAborted();

    if (401 === status) {
      // A delayed rejection of an older token must not evict a newer one.
      if (this.token?.value === accessToken) this.token = null;
      if (refreshUnauthorized) return this.fetchEmbeddings(inputs, signal, false);
    }
    if (status < 200 || status >= 300) {
      throw new EmbeddingHttpError(status);
    }

    if (!payload || !Array.isArray(payload.data) || payload.data.length !== inputs.length) {
      throw new Error('response.data has unexpected length');
    }

    const ordered = (payload.data as EmbeddingResponseItem[])
      .map((item, fallbackIndex) => ({
        item,
        index: 'number' === typeof item.index ? item.index : fallbackIndex,
      }))
      .sort((left, right) => left.index - right.index);

    if (
      ordered.some(
        ({ index }, position) =>
          !Number.isInteger(index) || index !== position
      )
    ) {
      throw new Error('response.data contains invalid or duplicate indexes');
    }

    return ordered.map(({ item }, index) => {
      const values = this.prepareVector(item.embedding, index);
      return {
        values,
        dimensions: values.length,
        model:
            'string' === typeof payload.model && payload.model.trim()
              ? payload.model
              : this.config.model,
      };
    });
  }

  private async embedGigaChatInputs(
    inputs: readonly string[],
    signal?: AbortSignal
  ): Promise<readonly EmbeddingVector[]> {
    // Embeddings-2 has a 512-token window. A conservative UTF-8 byte bound
    // stays below that window without truncating multilingual documents.
    const groups = inputs.map((input) => {
      const chunks: string[] = [];
      let chunk = '';
      let bytes = 0;
      for (const character of input) {
        const size = Buffer.byteLength(character, 'utf8');
        if (bytes + size > 400) {
          if (chunk.trim()) chunks.push(chunk);
          chunk = '';
          bytes = 0;
        }
        chunk += character;
        bytes += size;
      }
      if (chunk.trim()) chunks.push(chunk);
      return chunks;
    });
    const chunks = groups.flat();
    const embedded: EmbeddingVector[] = [];
    for (let offset = 0; offset < chunks.length; offset += this.config.batchSize) {
      signal?.throwIfAborted();
      embedded.push(...await this.fetchEmbeddings(
        chunks.slice(offset, offset + this.config.batchSize), signal
      ));
    }
    signal?.throwIfAborted();
    let offset = 0;
    return groups.map((group, index) => {
      const values = Array<number>(this.config.dimensions).fill(0);
      for (const chunk of group) {
        const vector = embedded[offset++];
        if (!vector) throw new Error('Incomplete GigaChat chunk embeddings');
        const weight = Buffer.byteLength(chunk, 'utf8');
        vector.values.forEach((value, axis) => { values[axis] += value * weight; });
      }
      return {
        values: this.prepareVector(values, index),
        dimensions: this.config.dimensions,
        model: this.config.model,
      };
    });
  }

  private prepareVector(value: unknown, index: number): readonly number[] {
    if (!Array.isArray(value) || 0 === value.length) {
      throw new Error(`embedding[${index}] is empty or invalid`);
    }

    const received = value as number[];
    if (received.some((item) => 'number' !== typeof item || !Number.isFinite(item))) {
      throw new Error(`embedding[${index}] contains a non-finite value`);
    }

    if (received.length !== this.config.dimensions) {
      throw new Error(
        `embedding[${index}] has ${received.length} dimensions; ` +
        `expected ${this.config.dimensions}`
      );
    }

    const norm = Math.sqrt(
      received.reduce((sum, item) => sum + item * item, 0)
    );
    if (!Number.isFinite(norm) || 0 === norm) {
      throw new Error(`embedding[${index}] has zero norm`);
    }

    return received.map((item) => item / norm);
  }

  private async getAccessToken(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    if (!this.config.url || !this.config.authUrl) {
      throw new Error('GIGACHAT_BASE_URL and GIGACHAT_AUTH_URL are required for embeddings');
    }
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.value;
    }
    this.token = null;
    if (!this.tokenRequest) {
      this.tokenRequest = this.requestAccessToken().finally(() => {
        this.tokenRequest = null;
      });
    }
    // All callers share OAuth's own request timeout. A query's shorter budget
    // cancels only its wait, preserving indexing and other query waiters.
    return this.withAbort(this.tokenRequest, signal);
  }

  private async requestAccessToken(): Promise<string> {
    if (!this.config.credentials || !this.config.authUrl || !this.config.scope) {
      throw new Error('GigaChat credentials, auth URL and scope are required');
    }
    const { status, payload } = await this.requestJson(this.config.authUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.config.credentials}`,
        RqUID: randomUUID(),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ scope: this.config.scope }).toString(),
    });
    if (status < 200 || status >= 300) throw new EmbeddingHttpError(status);
    if (!payload || typeof payload.access_token !== 'string' || !payload.access_token.trim() ||
          typeof payload.expires_at !== 'number' || !Number.isFinite(payload.expires_at) ||
          payload.expires_at <= Date.now() + 60_000) {
      throw new Error('GigaChat returned an invalid access token or expiration');
    }
    this.token = { value: payload.access_token, expiresAt: payload.expires_at };
    return this.token.value;
  }

  private async requestJson(
    url: string,
    options: RequestInit,
    signal?: AbortSignal
  ): Promise<{ status: number; payload: Record<string, unknown> | null }> {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const request = (async () => {
        const response = await fetch(url, { ...options, signal: controller.signal });
        if (!response.ok) {
          // Do not read or expose upstream error bodies, which may contain secrets.
          await response.body?.cancel();
          return { status: response.status, payload: null };
        }
        return {
          status: response.status,
          payload: await response.json() as Record<string, unknown>,
        };
      })();
      // Bound response-body parsing too, including transports that ignore abort.
      return await this.withAbort(request, controller.signal);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }

  private withAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return operation;
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => signal.removeEventListener('abort', abort);
      const abort = () => {
        cleanup();
        reject(this.abortReason(signal));
      };
      signal.addEventListener('abort', abort, { once: true });
      operation.then(
        (value) => {
          cleanup();
          if (signal.aborted) reject(this.abortReason(signal));
          else resolve(value);
        },
        (error: unknown) => {
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
      if (signal.aborted) abort();
    });
  }

  private abortReason(signal: AbortSignal): Error {
    const reason: unknown = signal.reason;
    return reason instanceof Error
      ? reason
      : new DOMException('Embedding request aborted', 'AbortError');
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof EmbeddingHttpError) {
      return 408 === error.status ||
        429 === error.status ||
        error.status >= 500;
    }

    return error instanceof TypeError ||
      (error instanceof Error && 'AbortError' === error.name);
  }

  private mockVector(input: string, dimensions: number): readonly number[] {
    const values = Array<number>(dimensions).fill(0);
    const tokens = input
      .toLocaleLowerCase('ru-RU')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    for (const token of tokens) {
      const digest = createHash('sha256').update(token).digest();
      for (let offset = 0; offset < 8; offset += 2) {
        const index = digest.readUInt16BE(offset) % dimensions;
        const sign = 0 === (digest[offset + 8] ?? 0) % 2 ? 1 : -1;
        values[index] = (values[index] ?? 0) + sign;
      }
    }

    const norm = Math.sqrt(
      values.reduce((sum, item) => sum + item * item, 0)
    );
    if (0 === norm) {
      throw new Error('Cannot create a mock embedding for empty input');
    }
    return values.map((item) => item / norm);
  }

  private async delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (milliseconds <= 0) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.withAbort(new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, milliseconds);
      }), signal);
    } finally {
      clearTimeout(timeout);
    }
  }
}

class EmbeddingHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = EmbeddingHttpError.name;
  }
}
