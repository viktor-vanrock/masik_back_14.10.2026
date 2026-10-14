import { ConfigService } from '@nestjs/config';
import { EmbeddingEnvType } from '@/configs/types';
import { EmbeddingService } from '../embedding.service';

const config: EmbeddingEnvType = {
  apiKey: '', queryInstruction: '',
  provider: 'gigachat', model: 'Embeddings-2', dimensions: 1024,
  sourceDimensions: 1024, specId: 'gigachat-test',
  url: 'https://gigachat.example/embeddings', authUrl: 'https://auth.example/oauth',
  credentials: 'test-credentials', scope: 'GIGACHAT_API_CORP',
  timeoutMs: 1000, maxRetries: 0, retryDelayMs: 0, batchSize: 16,
  retrievalCandidateLimit: 20,
};
const token = (value = 'access-token', expiresAt = Date.now() + 1800_000) => new Response(JSON.stringify({
  access_token: value, expires_at: expiresAt,
}));
const vectors = (value = [1, ...Array<number>(1023).fill(0)]) => new Response(JSON.stringify({
  data: [{ index: 0, embedding: value }],
}));
const service = (overrides: Partial<EmbeddingEnvType> = {}) => new EmbeddingService({
  getOrThrow: () => ({ ...config, ...overrides }),
} as unknown as ConfigService);
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
};

describe('GigaChat embeddings', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each(['url', 'authUrl'] as const)('does not contact a default host when %s is missing', async (name) => {
    const http = jest.spyOn(globalThis, 'fetch');
    await expect(service({ [name]: '' }).embedQuery('query')).rejects.toThrow('GIGACHAT_BASE_URL');
    expect(http).not.toHaveBeenCalled();
  });

  it('shares one OAuth request, caches the token and sends plain query/document text', async () => {
    const http = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(vectors())
      .mockResolvedValueOnce(vectors());
    const client = service();
    const result = await Promise.all([client.embedQuery(' Запрос '), client.embedDocument('Документ')]);
    expect(result[0]?.values).toHaveLength(1024);
    expect(http).toHaveBeenCalledTimes(3);
    expect(http.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      body: 'scope=GIGACHAT_API_CORP',
      headers: expect.objectContaining({ Authorization: 'Basic test-credentials', RqUID: expect.any(String) }),
    }));
    for (const [index, text] of [[1, 'Запрос'], [2, 'Документ']] as const) {
      const request = http.mock.calls[index]?.[1];
      expect(JSON.parse(request?.body as string)).toEqual({ model: 'Embeddings-2', input: [text] });
      expect(request?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer access-token' }));
    }
  });

  it('uses one cold-cache OAuth request for many callers with independent abort signals', async () => {
    const oauth = deferred<Response>();
    const http = jest.spyOn(globalThis, 'fetch').mockImplementation((url) =>
      url === config.authUrl ? oauth.promise : Promise.resolve(vectors())
    );
    const client = service();
    const queries = Array.from({ length: 12 }, (_, index) =>
      client.embedQuery(`query ${index}`, new AbortController().signal)
    );
    expect(http).toHaveBeenCalledTimes(1);
    oauth.resolve(token());
    expect(await Promise.all(queries)).toHaveLength(12);
    expect(http.mock.calls.filter(([url]) => url === config.authUrl)).toHaveLength(1);
    expect(http.mock.calls.filter(([url]) => url === config.url)).toHaveLength(12);
  });

  it('shares one refresh in the expiration grace window across queries and indexing', async () => {
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const refresh = deferred<Response>();
    let oauthCalls = 0;
    const http = jest.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (url !== config.authUrl) return Promise.resolve(vectors());
      oauthCalls += 1;
      return 1 === oauthCalls
        ? Promise.resolve(token('almost-expired', now + 60_001))
        : refresh.promise;
    });
    const client = service();
    await client.embedDocument('prime');
    now += 1; // Exactly 60 seconds left: the old token is no longer usable.
    const requests = [
      client.embedQuery('first', new AbortController().signal),
      client.embedQuery('second', new AbortController().signal),
      client.embedDocument('document'),
    ];
    expect(oauthCalls).toBe(2);
    refresh.resolve(token('fresh'));
    await Promise.all(requests);
    const headers = http.mock.calls.filter(([url]) => url === config.url)
      .map(([, options]) => options?.headers);
    expect(headers.slice(1)).toEqual(Array(3).fill(expect.objectContaining({ Authorization: 'Bearer fresh' })));
    expect(oauthCalls).toBe(2);
  });

  it('releases the shared OAuth slot after failure so a subsequent group can recover', async () => {
    const failedOAuth = deferred<Response>();
    const nextOAuth = deferred<Response>();
    let oauthCalls = 0;
    const http = jest.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (url !== config.authUrl) return Promise.resolve(vectors());
      oauthCalls += 1;
      return 1 === oauthCalls ? failedOAuth.promise : nextOAuth.promise;
    });
    const client = service();
    const failed = Promise.allSettled([
      client.embedQuery('first', new AbortController().signal),
      client.embedQuery('second', new AbortController().signal),
      client.embedDocument('document'),
    ]);
    expect(oauthCalls).toBe(1);
    failedOAuth.resolve(new Response('private error detail', { status: 403 }));
    const results = await failed;
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if ('rejected' === result.status) {
        expect(result.reason.message).toContain('HTTP 403');
        expect(result.reason.message).not.toContain('private error detail');
      }
    }
    const recovered = Promise.all([
      client.embedQuery('retry query', new AbortController().signal),
      client.embedDocument('retry document'),
    ]);
    expect(oauthCalls).toBe(2);
    nextOAuth.resolve(token('recovered'));
    await expect(recovered).resolves.toHaveLength(2);
    expect(http.mock.calls.filter(([url]) => url === config.url)).toHaveLength(2);
  });

  it('shares refresh after concurrent 401s and ignores a delayed rejection of the older token', async () => {
    const oldRequests = new Map<string, ReturnType<typeof deferred<Response>>>();
    const started = deferred<void>();
    const refreshStarted = deferred<void>();
    const refresh = deferred<Response>();
    let oauthCalls = 0;
    const http = jest.spyOn(globalThis, 'fetch').mockImplementation((url, options) => {
      if (url === config.authUrl) {
        oauthCalls += 1;
        if (1 === oauthCalls) return Promise.resolve(token('old'));
        refreshStarted.resolve();
        return refresh.promise;
      }
      const { input } = JSON.parse(options?.body as string) as { input: string[] };
      const authorization = (options?.headers as Record<string, string>).Authorization;
      if ('prime' === input[0] || 'Bearer fresh' === authorization) return Promise.resolve(vectors());
      const response = deferred<Response>();
      oldRequests.set(input[0], response);
      if (3 === oldRequests.size) started.resolve();
      return response.promise;
    });
    const client = service();
    await client.embedDocument('prime');
    const first = client.embedQuery('first', new AbortController().signal);
    const concurrent = client.embedQuery('concurrent', new AbortController().signal);
    const delayed = client.embedQuery('delayed', new AbortController().signal);
    await started.promise;
    oldRequests.get('first')!.resolve(new Response('', { status: 401 }));
    await refreshStarted.promise;
    oldRequests.get('concurrent')!.resolve(new Response('', { status: 401 }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(oauthCalls).toBe(2);
    refresh.resolve(token('fresh'));
    await Promise.all([first, concurrent]);
    // This old-token 401 arrives after the fresh token has been cached.
    oldRequests.get('delayed')!.resolve(new Response('', { status: 401 }));
    await expect(delayed).resolves.toHaveProperty('dimensions', 1024);
    await client.embedQuery('after refresh');
    expect(oauthCalls).toBe(2);
    expect(http.mock.calls[http.mock.calls.length - 1][1]?.headers)
      .toEqual(expect.objectContaining({ Authorization: 'Bearer fresh' }));
  });

  it('keeps a shared timeout and discards a late OAuth response after a newer request succeeds', async () => {
    jest.useFakeTimers();
    const lateOAuth = deferred<Response>();
    const recoveredOAuth = deferred<Response>();
    let oauthCalls = 0;
    const signals: AbortSignal[] = [];
    const http = jest.spyOn(globalThis, 'fetch').mockImplementation((url, options) => {
      if (url !== config.authUrl) return Promise.resolve(vectors());
      oauthCalls += 1;
      signals.push(options?.signal as AbortSignal);
      if (1 === oauthCalls) return Promise.resolve(token('old', Date.now() + 60_001));
      return 2 === oauthCalls ? lateOAuth.promise : recoveredOAuth.promise;
    });
    const client = service({ timeoutMs: 1000 });
    await client.embedDocument('prime');
    await jest.advanceTimersByTimeAsync(1);
    const waiting = Promise.allSettled([
      client.embedQuery('query', new AbortController().signal),
      client.embedDocument('document'),
    ]);
    expect(oauthCalls).toBe(2);
    await jest.advanceTimersByTimeAsync(1000);
    expect((await waiting).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(signals[1].aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);

    const recovered = client.embedQuery('recovered', new AbortController().signal);
    expect(oauthCalls).toBe(3);
    recoveredOAuth.resolve(token('fresh'));
    await recovered;
    lateOAuth.resolve(token('late-stale-token'));
    await jest.advanceTimersByTimeAsync(0);
    await client.embedQuery('use cache', new AbortController().signal);
    expect(oauthCalls).toBe(3);
    expect(http.mock.calls[http.mock.calls.length - 1][1]?.headers)
      .toEqual(expect.objectContaining({ Authorization: 'Bearer fresh' }));
    expect(jest.getTimerCount()).toBe(0);
  });

  it('refreshes once after a rejected token', async () => {
    const http = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(token('old'))
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(token('new'))
      .mockResolvedValueOnce(vectors());
    await service().embedQuery('query');
    expect(http.mock.calls[3]?.[1]?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer new' }));
    expect(http).toHaveBeenCalledTimes(4);
  });

  it('does not loop or keep a cached token when refreshed credentials are also rejected', async () => {
    const http = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(token('new'))
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(token('next'))
      .mockResolvedValueOnce(vectors());
    const client = service();
    await expect(client.embedQuery('query')).rejects.toThrow('HTTP 401');
    expect(http).toHaveBeenCalledTimes(4);
    await expect(client.embedQuery('next query')).resolves.toHaveProperty('dimensions', 1024);
    expect(http.mock.calls[4][0]).toBe(config.authUrl);
    expect(http.mock.calls[5][1]?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer next' }));
  });

  it('rejects a mismatched vector space instead of truncating GigaChat vectors', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(token())
      .mockResolvedValueOnce(vectors(Array<number>(1536).fill(1)));
    await expect(service().embedQuery('query')).rejects.toThrow('1536 dimensions');
  });

  it('does not expose OAuth response bodies on failure', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('secret from upstream', { status: 403 }));
    await expect(service().embedQuery('query')).rejects.toThrow('HTTP 403');
  });

  it('retries transport errors but reuses the OAuth token', async () => {
    const http = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockRejectedValueOnce(new TypeError('network reset'))
      .mockResolvedValueOnce(vectors());
    await expect(service({ maxRetries: 2 }).embedQuery('query')).resolves.toBeDefined();
    expect(http).toHaveBeenCalledTimes(4);
    expect(http.mock.calls.filter(([url]) => url === config.authUrl)).toHaveLength(1);
  });

  it.each([
    [Array<number>(1024).fill(0), 'zero norm'],
    [['not-a-number', ...Array<number>(1023).fill(0)], 'non-finite'],
  ])('rejects invalid vectors', async (vector, message) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(token()).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ index: 0, embedding: vector }] }))
    );
    await expect(service().embedQuery('query')).rejects.toThrow(message);
  });

  it('restores batch order and normalizes without truncation', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(token()).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [
        { index: 1, embedding: [0, 5, ...Array<number>(1022).fill(0)] },
        { index: 0, embedding: [3, 4, ...Array<number>(1022).fill(0)] },
      ] }))
    );
    const result = await service().embedDocuments(['first', 'second']);
    expect(result[0].values.slice(0, 2)).toEqual([0.6, 0.8]);
    expect(result[1].values.slice(0, 2)).toEqual([0, 1]);
    expect(result.every((item) => 1024 === item.values.length)).toBe(true);
  });

  it('embeds every part of a long document and normalizes the pooled vector', async () => {
    const batches: string[][] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      if (url === config.authUrl) return token();
      const input = JSON.parse(options?.body as string).input as string[];
      batches.push(input);
      return new Response(JSON.stringify({ data: input.map((text, index) => ({
        index, embedding: [text.includes('я') ? 1 : 0, text.includes('x') ? 1 : 0,
          ...Array<number>(1022).fill(0)],
      })) }));
    });
    const text = 'я'.repeat(500) + 'x'.repeat(9000);
    const result = await service().embedDocument(text);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat().join('')).toBe(text);
    expect(batches.flat().every((chunk) => Buffer.byteLength(chunk) <= 400)).toBe(true);
    expect(result.values[0]).toBeGreaterThan(0);
    expect(result.values[1]).toBeGreaterThan(0);
    expect(result.values.reduce((sum, value) => sum + value * value, 0)).toBeCloseTo(1);
  });

  it('does not start OAuth for an already aborted query', async () => {
    const http = jest.spyOn(globalThis, 'fetch');
    const controller = new AbortController();
    controller.abort();
    await expect(service().embedQuery('query', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(http).not.toHaveBeenCalled();
  });

  it.each([false, true])('cancels only one OAuth waiter, preserving indexing and other queries (query first: %s)', async (queryFirst) => {
    const requests: Array<{ signal: AbortSignal; resolve: (response: Response) => void }> = [];
    const http = jest.spyOn(globalThis, 'fetch').mockImplementation((url, options) => {
      if (url !== config.authUrl) return Promise.resolve(vectors());
      return new Promise<Response>((resolve) => {
        requests.push({ signal: options?.signal as AbortSignal, resolve });
      });
    });
    const client = service({ maxRetries: 2 });
    const controller = new AbortController();
    const first = queryFirst
      ? client.embedQuery('cancelled query', controller.signal)
      : client.embedDocument('document');
    const second = queryFirst
      ? client.embedDocument('document')
      : client.embedQuery('cancelled query', controller.signal);
    const query = queryFirst ? first : second;
    const document = queryFirst ? second : first;
    const survivor = client.embedQuery('survivor', new AbortController().signal);
    const rejected = expect(query).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests).toHaveLength(1);

    controller.abort();
    await rejected;
    expect(requests[0].signal.aborted).toBe(false);
    requests[0].resolve(token('index-token'));
    await expect(document).resolves.toHaveProperty('dimensions', 1024);
    await expect(survivor).resolves.toHaveProperty('dimensions', 1024);
    await client.embedQuery('next query');
    const lastCall = http.mock.calls[http.mock.calls.length - 1];
    expect(lastCall[1]?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer index-token' }));
    expect(requests).toHaveLength(1);
    const texts = http.mock.calls.filter(([url]) => url === config.url)
      .flatMap(([, options]) => (JSON.parse(options?.body as string) as { input: string[] }).input);
    expect(texts.sort()).toEqual(['document', 'next query', 'survivor']);
  });

  it('does not retry a cancelled OAuth waiter when surviving indexing retries a shared failure', async () => {
    const initialOAuth = deferred<Response>();
    let oauthCalls = 0;
    const http = jest.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (url !== config.authUrl) return Promise.resolve(vectors());
      oauthCalls += 1;
      return 1 === oauthCalls ? initialOAuth.promise : Promise.resolve(token('recovered'));
    });
    const client = service({ maxRetries: 1 });
    const controller = new AbortController();
    const query = client.embedQuery('cancelled query', controller.signal);
    const rejected = expect(query).rejects.toMatchObject({ name: 'AbortError' });
    const document = client.embedDocument('document');
    expect(oauthCalls).toBe(1);
    controller.abort();
    await rejected;
    initialOAuth.resolve(new Response('', { status: 503 }));
    await expect(document).resolves.toHaveProperty('dimensions', 1024);
    expect(oauthCalls).toBe(2);
    const embeddingCalls = http.mock.calls.filter(([url]) => url === config.url);
    expect(embeddingCalls).toHaveLength(1);
    expect(JSON.parse(embeddingCalls[0][1]?.body as string).input).toEqual(['document']);
  });

  it('bounds a hanging embedding request and does not retry after caller cancellation', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let requestSignal: AbortSignal | undefined;
    const http = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(token())
      .mockImplementation((_url, options) => {
        requestSignal = options?.signal as AbortSignal;
        entered();
        return new Promise<Response>(() => undefined);
      });
    const controller = new AbortController();
    const result = service({ maxRetries: 2 }).embedQuery('query', controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    controller.abort();
    await rejected;
    expect(requestSignal?.aborted).toBe(true);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('bounds JSON body parsing as well as response headers', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const response = vectors();
    jest.spyOn(response, 'json').mockImplementation(() => {
      entered();
      return new Promise(() => undefined);
    });
    const http = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(token()).mockResolvedValueOnce(response);
    const controller = new AbortController();
    const result = service().embedQuery('query', controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    controller.abort();
    await rejected;
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('aborts retry backoff immediately without another network request', async () => {
    jest.useFakeTimers();
    const http = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    const controller = new AbortController();
    const result = service({ maxRetries: 2, retryDelayMs: 10_000 })
      .embedQuery('query', controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await jest.advanceTimersByTimeAsync(0);
    expect(http).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(1);
    controller.abort();
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('applies one query deadline across multiple UTF-8 chunk batches', async () => {
    let entered!: () => void;
    const secondBatch = new Promise<void>((resolve) => { entered = resolve; });
    let batches = 0;
    const http = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === config.authUrl) return token();
      batches += 1;
      if (1 === batches) return vectors();
      entered();
      return new Promise<Response>(() => undefined);
    });
    const controller = new AbortController();
    const result = service({ batchSize: 1, maxRetries: 2 })
      .embedQuery('я'.repeat(600), controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await secondBatch;
    controller.abort();
    await rejected;
    expect(batches).toBe(2);
    expect(http).toHaveBeenCalledTimes(3);
  });

  it('keeps an independent request timeout for indexing without a query signal', async () => {
    jest.useFakeTimers();
    const http = jest.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => undefined));
    const result = service({ timeoutMs: 120_000 }).embedDocument('document');
    const rejected = expect(result).rejects.toThrow('Embedding provider is unavailable');
    await jest.advanceTimersByTimeAsync(119_999);
    expect((http.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await rejected;
    expect((http.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('detaches the caller signal after successful OAuth and embedding requests', async () => {
    const http = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(token()).mockResolvedValueOnce(vectors());
    const controller = new AbortController();
    await service().embedQuery('query', controller.signal);
    controller.abort();
    for (const [, options] of http.mock.calls) {
      expect((options?.signal as AbortSignal).aborted).toBe(false);
    }
    expect(http.mock.calls.map(([url]) => url)).toEqual([config.authUrl, config.url]);
  });
});
