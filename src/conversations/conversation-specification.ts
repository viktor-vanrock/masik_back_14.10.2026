export interface ConversationSpecification {
  goal?: string;
  domain?: string;
  language?: string;
  metric?: string;
  taskFormat?: string;
  name?: string;
  scenario?: 'create';
}

export function presentConversationSpecification(context: unknown): ConversationSpecification {
  const specification: ConversationSpecification = {};
  if (!context || 'object' !== typeof context || Array.isArray(context)) return specification;
  const snapshot = context as Record<string, unknown>;
  const requirements = snapshot.requirements;
  if (requirements && 'object' === typeof requirements && !Array.isArray(requirements)) {
    for (const [source, target] of [
      ['goal', 'goal'],
      ['scope', 'domain'],
      ['language', 'language'],
      ['evaluation', 'metric'],
      ['output_format', 'taskFormat'],
    ] as const) {
      const value = (requirements as Record<string, unknown>)[source];
      if ('string' === typeof value && value.trim()) specification[target] = value.trim();
    }
  }
  if ('string' === typeof snapshot.benchmark_name && snapshot.benchmark_name.trim()) {
    specification.name = snapshot.benchmark_name.trim();
  }
  if (true === snapshot.creation_requested) specification.scenario = 'create';
  return specification;
}
