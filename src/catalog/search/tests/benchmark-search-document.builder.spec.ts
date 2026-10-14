import { BenchmarkSearchDocumentBuilder } from '../benchmark-search-document.builder';
import { BenchmarkSearchSource } from '../types';

describe('BenchmarkSearchDocumentBuilder', () => {
  const source: BenchmarkSearchSource = {
    id: 'test-id',
    name: 'Диалоги',
    nameEn: 'Dialogues',
    description: 'Оценка диалоговых моделей',
    descriptionEn: 'Dialogue model evaluation',
    shortDescription: null,
    taskDescription: 'Ответить пользователю',
    instructions: null,
    instructionsEn: null,
    contextFieldFormat: null,
    answerFieldFormat: null,
    evaluationLogic: null,
    recommendedMetricsDescription: null,
    requiredGigaChatQualityLevel: null,
    catalogEntry: null,
    deletedAt: null,
    updatedAt: new Date('2026-08-22T20:00:00.000Z'),
    benchmark: {
      name: 'Russian NLP',
      nameEn: 'Russian NLP',
      description: null,
      descriptionEn: null,
      deletedAt: null,
    },
    macroGroup: { name: 'Общение', nameEn: 'Communication' },
    taskType: { name: 'Генерация', nameEn: 'Generation' },
    language: { name: 'Русский', nameEn: 'Russian' },
    difficulty: null,
    skills: ['conversation'],
    abilityTags: ['multi-turn'],
    subGroups: [],
    abilityTaxons: [],
    domains: [{ name: 'Диалоги', nameEn: 'Dialogues' }],
    subdomains: [],
    modalities: [],
    capabilities: [],
    datasetSubsamples: [
      {
        name: 'Support',
        nameEn: 'Support',
        description: 'Обращения в поддержку',
        split: 'test',
      },
    ],
  };

  it('builds one stable document with taxonomy and subsample summaries', () => {
    const builder = new BenchmarkSearchDocumentBuilder();
    const first = builder.build(source);
    const second = builder.build(source);

    expect(first).toBe(second);
    expect(first).toContain('Benchmark: Диалоги / Dialogues');
    expect(first).toContain('Language: Русский / Russian');
    expect(first).toContain('Skills: conversation');
    expect(first).toContain('Dataset subsamples:');
    expect(first).toContain('Обращения в поддержку');
  });
});
