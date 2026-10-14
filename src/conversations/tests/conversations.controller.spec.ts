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

  it('omits internal model context from list responses while preserving owner scope', async () => {
    findAll.mockResolvedValue({ data: [record], total: 1 });
    const query = { page: 1, limit: 20 };
    const response = await controller.findAll(query, user);
    expect(findAll).toHaveBeenCalledWith(query, user);
    expect(response).toEqual({ data: [{ id: 'conversation', userId: user.id }], total: 1 });
  });

  it('omits internal model context from detail responses while preserving owner scope', async () => {
    findByIdWithMessages.mockResolvedValue({ ...record, messages: [] });
    expect(await controller.findById(record.id, user)).toEqual({ id: record.id, userId: user.id, messages: [] });
    expect(findByIdWithMessages).toHaveBeenCalledWith(record.id, user);
  });
});
