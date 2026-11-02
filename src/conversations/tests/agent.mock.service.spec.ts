import { AgentMessageType } from '@/common/enums/agentMessageType.enum';
import { AgentMockService } from '../mock/agent.mock.service';
import type { AgentMessagePayload } from '../types';

describe('AgentMockService create_new workflow', () => {
  const conversationId = '11111111-1111-4111-8111-111111111111';
  let service: AgentMockService;
  let received: AgentMessagePayload[];

  beforeEach(() => {
    service = new AgentMockService();
    received = [];
    service.connect(conversationId);
    service.onMessage(conversationId, (payload) => received.push(payload));
  });

  afterEach(() => service.close(conversationId));

  it('runs a creation wizard and returns a draft instead of a recommendation', async () => {
    service.send(conversationId, {
      type: 'init',
      intent: 'create_new',
      history: [],
    });
    await flushMessages();
    expect(last(received)).toMatchObject({
      type: AgentMessageType.Question,
      content: { label: 'Опишите задачу для нового бенчмарка' },
    });

    service.send(conversationId, {
      type: 'message',
      content: { kind: 'text', label: 'Проверка генерации кода' },
    });
    await flushMessages();
    expect(last(received)).toMatchObject({
      content: { label: 'Какой домен вас интересует?' },
    });

    for (const id of ['1', '2', '3']) {
      service.send(conversationId, {
        type: 'message',
        content: { kind: 'option', id, label: id },
      });
      await flushMessages();
    }

    expect(last(received)).toMatchObject({
      type: AgentMessageType.Result,
      isFinal: true,
      content: {
        label: 'Черновик нового бенчмарка сформирован (mock)',
        resultKey: 'mock_draft_ready',
      },
    });
    expect(received).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.objectContaining({
            label: expect.stringContaining('вам подходит'),
          }),
        }),
      ])
    );
  });

  it('continues with creation questions after a rejected catalogue result', async () => {
    service.send(conversationId, {
      type: 'init',
      intent: 'create_new',
      history: [
        {
          role: 'user',
          content: {
            kind: 'text',
            label: 'Нужен бенчмарк для генерации кода',
          },
        },
        {
          role: 'user',
          content: {
            kind: 'recommendation_rejected',
            testId: 'catalogue-test-id',
          },
        },
      ],
    });
    await flushMessages();

    expect(last(received)).toMatchObject({
      type: AgentMessageType.Question,
      content: { label: 'Какой домен вас интересует?' },
    });
  });
});

function last(messages: AgentMessagePayload[]): AgentMessagePayload | undefined {
  return messages.at(-1);
}

async function flushMessages(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
