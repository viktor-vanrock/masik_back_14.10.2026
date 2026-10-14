import { ConfigService } from '@nestjs/config';
import { EmbeddingEnvType } from '@/configs/types';
import { EmbeddingService } from '../embedding.service';

describe('EmbeddingService', () => {
  const config: EmbeddingEnvType = {
    provider: 'mock',
    url: '',
    apiKey: '',
    model: 'mock-hashed-bow-v1',
    specId: 'mock-hashed-bow-v1:test:dim-1536:l2',
    dimensions: 1_536,
    sourceDimensions: 4_096,
    queryInstruction: 'retrieve benchmarks',
    timeoutMs: 1_000,
    maxRetries: 2,
    retryDelayMs: 0,
    retrievalCandidateLimit: 20,
    batchSize: 32,
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates deterministic normalized vectors for local development', async () => {
    const service = createService(config);
    const first = await service.embedQuery('русский диалоговый бенчмарк');
    const second = await service.embedQuery('русский диалоговый бенчмарк');

    expect(first).toEqual(second);
    expect(first.values).toHaveLength(1_536);
    expect(norm(first.values)).toBeCloseTo(1, 10);
  });

  it('sends plain text for queries and documents without legacy instructions', async () => {
    const httpConfig = httpConfiguration();
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(embeddingResponse([[3, 4]]))
      .mockResolvedValueOnce(embeddingResponse([[4, 3]]));
    const service = createService(httpConfig);

    await service.embedQuery('медицинские вопросы');
    await service.embedDocument('Описание бенчмарка');

    const queryBody = requestBody(fetchMock, 1);
    const documentBody = requestBody(fetchMock, 2);
    expect(queryBody).toEqual({
      model: 'Embeddings-2',
      input: ['медицинские вопросы'],
    });
    expect(documentBody).toEqual({
      model: 'Embeddings-2',
      input: ['Описание бенчмарка'],
    });
    expect(queryBody).not.toHaveProperty('dimensions');
  });

  it('rejects a legacy 4096-dimensional vector without truncating it', async () => {
    const full = Array<number>(4_096).fill(0);
    full[0] = 3;
    full[1] = 4;
    full[2_000] = 1_000;
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(embeddingResponse([full]));
    const service = createService(httpConfiguration({
      dimensions: 1_024,
      sourceDimensions: 1_024,
    }));

    await expect(service.embedDocument('document')).rejects.toThrow('expected 1024');
  });

  it.each([
    [[1, 2, 3], 'expected 1024'],
    [['not-a-number', 1] as unknown as number[], 'non-finite'],
    [Array<number>(1_024).fill(0), 'zero norm'],
  ])('rejects an invalid provider vector', async (vector, message) => {
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(embeddingResponse([vector]));
    const service = createService(httpConfiguration({
      dimensions: 1_024,
      sourceDimensions: 1_024,
    }));

    await expect(service.embedDocument('document')).rejects.toThrow(message);
  });

  it('retries retryable failures up to two times', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockRejectedValueOnce(new TypeError('network reset'))
      .mockResolvedValueOnce(embeddingResponse([[3, 4]]));
    const service = createService(httpConfiguration({
      dimensions: 2,
      sourceDimensions: 4,
    }));

    await expect(service.embedDocument('document')).resolves.toEqual(
      expect.objectContaining({ values: [0.6, 0.8] })
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not retry a non-retryable 4xx response', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response('', { status: 400 }));
    const service = createService(httpConfiguration());

    await expect(service.embedDocument('document')).rejects.toThrow('HTTP 400');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

const createService = (config: EmbeddingEnvType): EmbeddingService =>
  new EmbeddingService({
    getOrThrow: jest.fn().mockReturnValue(config),
  } as unknown as ConfigService);

const httpConfiguration = (
  overrides: Partial<EmbeddingEnvType> = {}
): EmbeddingEnvType => ({
  ...{
    provider: 'gigachat' as const,
    url: 'https://gigachat.example/api/v1/embeddings',
    authUrl: 'https://auth.example/oauth',
    credentials: 'test-credentials',
    scope: 'GIGACHAT_API_CORP',
    apiKey: 'ignored-legacy-api-key',
    model: 'Embeddings-2',
    specId: 'gigachat:test',
    dimensions: 2,
    sourceDimensions: 4,
    queryInstruction: 'retrieve benchmarks',
    timeoutMs: 1_000,
    maxRetries: 2,
    retryDelayMs: 0,
    retrievalCandidateLimit: 20,
    batchSize: 32,
  },
  ...overrides,
});

const embeddingResponse = (
  vectors: readonly (readonly number[])[],
  indexes?: readonly number[]
): Response => new Response(JSON.stringify({
  model: 'Embeddings-2',
  data: vectors.map((embedding, position) => ({
    index: indexes?.[position] ?? position,
    embedding,
  })),
}), { status: 200 });

const tokenResponse = (): Response => new Response(JSON.stringify({
  access_token: 'test-token', expires_at: Date.now() + 1_800_000,
}));

const requestBody = (
  fetchMock: jest.SpyInstance,
  callIndex: number
): Record<string, unknown> => {
  const options = fetchMock.mock.calls[callIndex]?.[1] as RequestInit;
  if ('string' !== typeof options.body) {
    throw new Error('Expected fetch body to be a JSON string');
  }
  return JSON.parse(options.body) as Record<string, unknown>;
};

const norm = (values: readonly number[]): number =>
  Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
