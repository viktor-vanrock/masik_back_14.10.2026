import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FactorySelectionService } from '../factory-selection.service';

describe('Factory candidate selection', () => {
  const candidates = [{ testId: 'ru', document: 'Русский язык', score: 0.5, sourceUpdatedAt: 'now' }];
  const service = new FactorySelectionService({ getOrThrow: () => ({
    mode: 'ws', wsUrl: 'wss://factory.test/ws/interviewer', apiKey: 'service-secret',
  }) } as unknown as ConfigService);
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  beforeEach(() => { global.fetch = fetchMock; fetchMock.mockReset(); });
  afterAll(() => { global.fetch = originalFetch; });

  it('sends candidates and authentication to Factory and returns its explanation', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ recommendations: [
      { benchmarkId: 'ru', explanation: 'Подходит по языку.' },
    ] }) });
    expect(await service.select('request-id', 'русский', candidates, 1)).toEqual([
      { testId: 'ru', explanation: 'Подходит по языку.' },
    ]);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe('https://factory.test/api/v1/recommendations/select');
    expect(options.headers.Authorization).toBe('Bearer service-secret');
    expect(options.headers['X-Request-ID']).toBe('request-id');
    expect(JSON.parse(options.body)).toEqual({ query: 'русский', topK: 1,
      candidates: [{ benchmarkId: 'ru', document: 'Русский язык', score: 0.5 }] });
  });

  it.each([
    [{ benchmarkId: 'unknown', explanation: 'reason' }],
    [{ benchmarkId: 'ru', explanation: ' ' }],
    [{ benchmarkId: 'ru', explanation: 'reason' }, { benchmarkId: 'ru', explanation: 'reason' }],
  ])('rejects invalid choices', async (...items) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ recommendations: items }) });
    await expect(service.select('request', 'query', candidates, 1)).rejects.toThrow('Invalid Factory');
  });

  it('skips calls for an empty index, but surfaces Factory outages', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    expect(await service.select('request', 'query', [], 1)).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('requestId="request", reason="no_candidates"'));
    log.mockRestore();
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(service.select('request', 'query', candidates, 1)).rejects.toThrow('HTTP 503');
  });

  it('logs explicit mock selection without calling the model', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const mockService = new FactorySelectionService({
      getOrThrow: () => ({ mode: 'mock' }),
    } as unknown as ConfigService);
    expect(await mockService.select('mock-request', 'русский', candidates, 1)).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(
      'requestId="mock-request", mode="mock", reason="agent_mode_mock"'
    ));
    warn.mockRestore();
  });
});
