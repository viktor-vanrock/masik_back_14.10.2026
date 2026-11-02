export type DemoRequest = { status: 'ready'; revision: string };

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && 'object' === typeof value && !Array.isArray(value) ? value as Record<string, unknown> : null;
const nonblank = (value: unknown): value is string => 'string' === typeof value && value.trim().length > 0;
const textList = (value: unknown): boolean => Array.isArray(value) && value.length > 0 && value.every(nonblank);
const items = (value: unknown): boolean => Array.isArray(value) && value.length > 0 &&
  value.every((item) => nonblank(object(item)?.id) && nonblank(object(item)?.text));

/** Public readiness never exposes the Brief, tool history or a guessed draft. */
export function presentDemoRequest(context: unknown): DemoRequest | null {
  const state = object(context);
  const prepared = object(state?.prepared_brief);
  const requirements = object(prepared?.requirements);
  const current = object(state?.requirements);
  const brief = object(prepared?.brief);
  const keys = ['goal', 'scope', 'input_format', 'output_format', 'language', 'difficulty', 'evaluation', 'task_count'];
  if (!prepared || prepared.status !== 'ready' || !nonblank(prepared.revision) ||
      prepared.revision.length > 128 || prepared.schema_version !== '1.0' || !requirements || !current ||
      !brief || brief.schema_version !== '1.0' ||
      keys.some((key) => !nonblank(requirements[key]) || requirements[key] !== current[key]) ||
      !Number.isInteger(prepared.num_tasks) || Number(prepared.num_tasks) < 1 || Number(prepared.num_tasks) > 100 ||
      ['decision', 'evaluation_target', 'task_context', 'quality_requirements', 'taxonomy', 'test']
        .some((key) => !object(brief[key]))) return null;
  const test = object(brief.test)!;
  const taxonomy = object(brief.taxonomy)!;
  if (!nonblank(object(brief.decision)?.type) || !nonblank(object(brief.evaluation_target)?.type) ||
      !nonblank(object(brief.task_context)?.real_world_tasks) || !items(object(brief.task_context)?.required_scenarios) ||
      !items(object(brief.quality_requirements)?.critical_failures) || !textList(taxonomy.macro_group_codes) ||
      !nonblank(taxonomy.knowledge_level) || !textList(object(test.input)?.modalities) ||
      !textList(object(test.output)?.modalities) || !textList(test.languages) || !nonblank(test.output_format) ||
      !nonblank(test.interaction_mode) || !nonblank(test.difficulty) || !textList(object(test.evaluation)?.methods)) return null;
  return { status: 'ready', revision: prepared.revision };
}
