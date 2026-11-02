import { Role } from '@/common/enums/role.enum';
import { ConversationsController } from '../conversations.controller';
import type { ConversationsService } from '../conversations.service';

describe('Public conversation context isolation', () => {
  const user = { id: 'owner', username: 'owner', role: Role.User };
  const hidden = { messages: [{ role: 'tool', content: 'internal search results' }] };
  const record = { id: 'conversation', userId: user.id, agentContext: hidden };
  const findAll = jest.fn();
  const findByIdWithMessages = jest.fn();
  const controller = new ConversationsController({ findAll, findByIdWithMessages } as unknown as ConversationsService);

  beforeEach(() => jest.clearAllMocks());

  it('omits internal model context from list responses while preserving owner scope', async () => {
    findAll.mockResolvedValue({ data: [record], total: 1 });
    const query = { page: 1, limit: 20 };
    const response = await controller.findAll(query, user);
    expect(findAll).toHaveBeenCalledWith(query, user);
    expect(response).toEqual({ data: [{ id: 'conversation', userId: user.id }], total: 1 });
  });

  it('omits internal model context from detail responses while preserving owner scope', async () => {
    findByIdWithMessages.mockResolvedValue({ ...record, messages: [] });
    expect(await controller.findById(record.id, user)).toEqual({ id: record.id, userId: user.id, messages: [], specification: {} });
    expect(findByIdWithMessages).toHaveBeenCalledWith(record.id, user);
  });

  it('projects only the seven public specification fields from model context', async () => {
    findByIdWithMessages.mockResolvedValue({ ...record, title: 'Chat title', messages: [], agentContext: {
      ...hidden,
      requirements: {
        goal: '  Проверить знания  ', scope: ' Налоги ', language: ' русский ', evaluation: ' Доля правильных ответов ',
        output_format: ' Один из четырёх вариантов ', input_format: 'internal input', difficulty: 'internal difficulty',
        task_count: '10', extra: 'internal extra',
      },
      benchmark_name: ' Налоговый тест ', creation_requested: true, generation_job_id: 'internal job',
      brief: { secret: 'internal brief' }, tool_calls: ['internal tools'],
    } });
    expect(await controller.findById(record.id, user)).toEqual({
      id: record.id, userId: user.id, title: 'Chat title', messages: [],
      specification: {
        goal: 'Проверить знания', domain: 'Налоги', language: 'русский', metric: 'Доля правильных ответов',
        taskFormat: 'Один из четырёх вариантов', name: 'Налоговый тест', scenario: 'create',
      },
    });
  });

  it.each([undefined, null, [], 'context', 1, true])('returns an empty specification for invalid context %j', async (agentContext) => {
    findByIdWithMessages.mockResolvedValue({ ...record, agentContext, title: 'Not a benchmark name', messages: [] });
    const response = await controller.findById(record.id, user);
    expect(response.specification).toEqual({});
    expect(response).not.toHaveProperty('agentContext');
  });

  it.each([undefined, null, [], 'requirements', 1])('ignores invalid requirements %j', async (requirements) => {
    findByIdWithMessages.mockResolvedValue({ ...record, messages: [], agentContext: { requirements } });
    expect((await controller.findById(record.id, user)).specification).toEqual({});
  });

  it('ignores blank, nested and non-string values without parsing chat text or title', async () => {
    findByIdWithMessages.mockResolvedValue({ ...record, title: 'Название из заголовка', messages: [
      { content: '**Язык:** русский\n**Название:** Не извлекать из Markdown' },
    ], agentContext: {
      requirements: { goal: ' \n ', scope: { name: 'Домен' }, language: ['русский'], evaluation: 1, output_format: false },
      benchmark_name: { name: 'Название' }, creation_requested: 'true',
    } });
    expect((await controller.findById(record.id, user)).specification).toEqual({});
  });

  it('returns partial fields and does not infer a scenario from intent alone', async () => {
    findByIdWithMessages.mockResolvedValue({ ...record, intent: 'create_new', messages: [], agentContext: {
      requirements: { language: ' русский ' }, creation_requested: false,
    } });
    expect((await controller.findById(record.id, user)).specification).toEqual({ language: 'русский' });
  });
});
