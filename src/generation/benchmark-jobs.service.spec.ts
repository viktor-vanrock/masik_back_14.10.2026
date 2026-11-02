import { BenchmarkJobsService } from './benchmark-jobs.service';

jest.mock('@/prisma/prisma.service', () => ({ PrismaService: class {} }));

const id = '14a2b43e-8935-4077-a30e-635f708d904f';
const lease = '41b8d422-c51e-4f0b-b22e-7a2ef8a2be75';

describe('Inventor worker job contract', () => {
  const execute = jest.fn();
  const query = jest.fn();
  const tx = { $executeRaw: execute, $queryRaw: query };
  const prisma = { ...tx, $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) };
  const service = new BenchmarkJobsService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    execute.mockResolvedValue(1);
    query.mockResolvedValue([]);
  });

  it('returns an empty queue without inventing a job', async () => {
    expect(await service.claim()).toEqual({ job: null });
  });

  it('rejects stale heartbeats and completions', async () => {
    execute.mockResolvedValue(0);
    await expect(service.heartbeat(id, { lease_token: lease, progress: {} }))
      .rejects.toMatchObject({ status: 409 });
    await expect(service.complete(id, {
      lease_token: lease, result: { status: 'failed', error: { code: 'timeout' } },
    })).rejects.toMatchObject({ status: 409 });
  });

  it.each([undefined, {}, { lease_token: '../bad' }])('rejects invalid leases before SQL', async (body) => {
    await expect(service.heartbeat(id, body)).rejects.toMatchObject({ status: 422 });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'running' },
    { status: 'succeeded', source: 'seed', examples: [{}] },
    { status: 'succeeded', source: 'evolution', examples: [] },
    { status: 'succeeded', source: 'evolution', examples: ['bad'] },
    { status: 'succeeded', source: 'evolution', examples: Array(101).fill({}) },
    { status: 'failed' },
    { status: 'failed', error: 'bad' },
    { status: 'failed', error: {} },
    { status: 'failed', error: { code: '' } },
    { status: 'failed', error: { code: 'timeout', message: {} } },
    { status: 'failed', error: { code: 'timeout', message: 'x'.repeat(2049) } },
    { status: 'failed', error: { code: 'timeout', internal: {} } },
  ])('rejects invalid or preview results', async (result) => {
    await expect(service.complete(id, { lease_token: lease, result }))
      .rejects.toMatchObject({ status: 422 });
    expect(execute).not.toHaveBeenCalled();
  });

  it('accepts a batch of 30 evolved tasks', async () => {
    const result = {
      status: 'succeeded', source: 'evolution',
      examples: Array.from({ length: 30 }, (_, index) => ({ index, input: `Task ${index}` })),
    };
    expect(await service.complete(id, { lease_token: lease, result }))
      .toEqual({ status: 'succeeded', job_id: id });
  });

  it('rejects oversized updates', async () => {
    await expect(service.heartbeat(id, {
      lease_token: lease, progress: { data: 'x'.repeat(7 * 1024 * 1024) },
    })).rejects.toMatchObject({ status: 413 });
    expect(execute).not.toHaveBeenCalled();
  });

  it('reports unknown jobs', async () => {
    await expect(service.get(id)).rejects.toMatchObject({ status: 404 });
    await expect(service.getProgressForSession('unknown')).resolves.toBeNull();
  });

  it('returns bounded progress without exposing the job payload or lease', async () => {
    query.mockResolvedValue([{
      job_id: id, status: 'running', attempt: 1, phase: 'generating',
      completed_generations: 4, total_generations: 3,
      completed_mutations: 4, total_mutations: 12,
      completed_llm_calls: 20, total_llm_calls: 500,
      estimated_completion_at: '2026-09-22T15:00:00+00:00',
      examples_count: null, error_code: null, updated_at: 'now',
      brief: { private: true }, result: { private: true }, lease_token: lease,
    }]);
    expect(await service.getProgressForSession('session')).toEqual({
      job_id: id, status: 'running', attempt: 1, phase: 'generating',
      completed_generations: 3, total_generations: 3,
      completed_mutations: 4, total_mutations: 12,
      completed_llm_calls: 20, total_llm_calls: 500,
      estimated_completion_at: '2026-09-22T15:00:00.000Z',
      examples_count: null, error_code: null, updated_at: 'now',
    });
    query.mockResolvedValue([{ status: 'accepted', total_generations: null }]);
    expect(await service.getProgressForSession('session')).toMatchObject({
      status: 'accepted', completed_generations: 0, total_generations: null,
      completed_mutations: 0, total_mutations: null, estimated_completion_at: null,
    });
  });

  it.each([null, '12', -1, 1.5, true])('ignores malformed mutation totals: %s', async (total) => {
    query.mockResolvedValue([{ status: 'running', phase: 'generating',
      total_mutations: total, completed_mutations: -5,
      estimated_completion_at: 'invalid-date' }]);
    expect(await service.getProgressForSession('session')).toMatchObject({
      total_mutations: null, completed_mutations: 0, estimated_completion_at: null,
    });
  });

  it.each(['succeeded', 'failed'])('clears ETA for terminal status %s', async (status) => {
    query.mockResolvedValue([{ status, phase: 'generating', total_mutations: 5000,
      completed_llm_calls: 1, total_llm_calls: 5000,
      completed_mutations: 1, estimated_completion_at: '2026-09-22T15:00:00Z' }]);
    expect(await service.getProgressForSession('session')).toMatchObject({
      total_mutations: 2000, completed_mutations: 1, estimated_completion_at: null,
    });
  });

  it.each([null, '12', -1, 1.5, true, Number.MAX_SAFE_INTEGER + 1])('ignores invalid LLM budgets: %s', async (total) => {
    query.mockResolvedValue([{ status: 'running', phase: 'generating',
      total_llm_calls: total, completed_llm_calls: -5,
      estimated_completion_at: '2026-09-22T15:00:00Z' }]);
    expect(await service.getProgressForSession('session')).toMatchObject({
      total_llm_calls: null, completed_llm_calls: 0, estimated_completion_at: null,
    });
  });

  it('exposes seed-call ETA before any mutation and clears it if the budget is exceeded', async () => {
    query.mockResolvedValue([{ status: 'running', phase: 'starting',
      total_mutations: 1, completed_mutations: 0,
      total_llm_calls: 10000, completed_llm_calls: 1,
      estimated_completion_at: '2026-09-22T15:00:00Z' }]);
    expect(await service.getProgressForSession('session')).toMatchObject({
      total_llm_calls: 10000, completed_llm_calls: 1,
      estimated_completion_at: '2026-09-22T15:00:00.000Z',
    });
    query.mockResolvedValue([{ status: 'running', phase: 'generating',
      total_llm_calls: 10, completed_llm_calls: 11,
      estimated_completion_at: '2026-09-22T15:00:00Z' }]);
    expect(await service.getProgressForSession('session')).toMatchObject({
      completed_llm_calls: 11, estimated_completion_at: null,
    });
  });

  it.each([-1, 1.5, '2', 2147483648])('rejects an invalid progress version', async (version) => {
    await expect(service.heartbeat(id, { lease_token: lease, progress: {}, progress_version: version }))
      .rejects.toMatchObject({ status: 422 });
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns every completed example without the surrounding execution data', async () => {
    const examples = Array.from({ length: 30 }, (_, index) => ({
      input: `Task ${index}`, output: `Answer ${index}`,
      task: { question: `Task ${index}`, options: ['A', 'B'], correct_answer: 'B' },
    }));
    query.mockResolvedValue([{
      status: 'succeeded', examples, examples_count: 30,
      result: { examples, config: { api_key: 'secret' } }, brief: {}, lease_token: lease,
    }]);
    const response = await service.getProgressForSession('session');
    expect(response?.examples).toEqual(examples);
    expect(response?.examples_count).toBe(30);
    expect(response).not.toHaveProperty('result');
    expect(response).not.toHaveProperty('brief');
    expect(response).not.toHaveProperty('lease_token');
    for (const status of ['accepted', 'running', 'failed']) {
      query.mockResolvedValue([{ status, examples }]);
      expect(await service.getProgressForSession('session')).not.toHaveProperty('examples');
    }
  });

  it('accepts a structured failure', async () => {
    await expect(service.complete(id, {
      lease_token: lease, result: { status: 'failed', error: { code: 'generation_timeout' } },
    })).resolves.toEqual({ status: 'failed', job_id: id });
  });
});
