import { presentDemoRequest } from '../demo-request';

const requirements = {
  goal: 'Проверить знания', scope: 'Налоги', input_format: 'Текст', output_format: 'MCQA',
  language: 'Русский', difficulty: 'Средняя', evaluation: 'Exact Match', task_count: '10',
};
const brief = {
  schema_version: '1.0', decision: { type: 'compare_models' }, evaluation_target: { type: 'model' },
  task_context: { real_world_tasks: 'Налоги', required_scenarios: [{ id: 'scenario', text: 'Налоговый вычет' }] },
  quality_requirements: { critical_failures: [{ id: 'failure', text: 'Неверный ответ' }] },
  taxonomy: { macro_group_codes: ['knowledge'], knowledge_level: 'basic' },
  test: { input: { modalities: ['text'] }, output: { modalities: ['text'] }, languages: ['ru'],
    output_format: 'mcqa', interaction_mode: 'single_turn', difficulty: 'medium', evaluation: { methods: ['exact_match'] } },
};
const prepared = { status: 'ready', revision: 'revision-1', schema_version: '1.0', requirements, brief, num_tasks: 10 };
const state = { requirements, prepared_brief: prepared, messages: [{ content: 'internal' }] };

describe('Public DEMO request projection', () => {
  it('exposes only ready state and revision without mutating the durable Brief', () => {
    const original = JSON.stringify(state);
    expect(presentDemoRequest(state)).toEqual({ status: 'ready', revision: 'revision-1' });
    expect(JSON.stringify(state)).toBe(original);
  });

  it.each([null, [], 'brief', {}, { prepared_brief: 'not-an-object' },
    { ...state, prepared_brief: null }, { ...state, requirements: {} }])('does not infer readiness from invalid state %j', (context) => {
    expect(presentDemoRequest(context)).toBeNull();
  });

  it.each(['goal', 'scope', 'input_format', 'output_format', 'language', 'difficulty', 'evaluation', 'task_count'])(
    'hides readiness after a %s correction or clearing', (key) => {
      expect(presentDemoRequest({ ...state, requirements: { ...requirements, [key]: 'Исправлено' } })).toBeNull();
      expect(presentDemoRequest({ ...state, requirements: { ...requirements, [key]: '' } })).toBeNull();
    }
  );

  it.each([{ status: 'draft' }, { revision: '' }, { revision: 'x'.repeat(129) }, { schema_version: '2.0' },
    { requirements: { ...requirements, language: ' ' } }, { brief: {} }, { brief: { ...brief, test: {} } },
    { brief: { ...brief, task_context: { real_world_tasks: '' } } },
    { brief: { ...brief, quality_requirements: {} } }, { num_tasks: 0 }, { num_tasks: 101 },
    { num_tasks: '10' }, { num_tasks: null }])('rejects malformed prepared documents %j', (change) => {
    expect(presentDemoRequest({ ...state, prepared_brief: { ...prepared, ...change } })).toBeNull();
  });
});
