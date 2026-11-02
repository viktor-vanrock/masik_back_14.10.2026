import 'dotenv/config';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateBenchmarkTestDto } from '@/catalog/benchmark-test/dto/createBenchmarkTest.dto';

type DictionaryItem = { name: string; nameEn: string; macroGroup?: string; domain?: string };
type SourceTest = Record<string, unknown> & {
  benchmark: string;
  name: string;
  nameEn: string;
  description: string;
  shortDescription: string;
  taskDescription: string;
  macroGroup: string;
  subGroups: string[];
  capabilities: string[];
  featureLabels: string[];
  metrics: string[];
  subsets: unknown[];
};
export type SeedSource = {
  taxonomy: Record<string, DictionaryItem[]>;
  Benchmark: { name: string; nameEn: string; description?: string; descriptionEn?: string }[];
  BenchmarkTest: SourceTest[];
};
type NamedId = { id: string; name: string; nameEn: string; parentId?: string | null };
type IdMaps = Record<string, Map<string, string>>;
const dictionaries = [
  ['MacroGroup', 'taxonomy/macro-groups'],
  ['Domain', 'domains/domains'],
  ['SubGroup', 'taxonomy/sub-groups'],
  ['AbilityTaxon', 'taxonomy/ability-taxons'],
  ['TaskType', 'parameters/task-types'],
  ['Modality', 'parameters/modalities'],
  ['Language', 'parameters/languages'],
  ['Difficulty', 'parameters/difficulties'],
  ['Capability', 'parameters/capabilities'],
  ['Subdomain', 'domains/subdomains'],
] as const;
const text = (value: string): string => value.replace(/\s+/g, ' ').trim();
const key = (value: string): string => text(value).toLowerCase();
const childKey = (name: string, parent: string): string => `${key(parent)}\0${key(name)}`;
const names = (value: unknown): string[] => [...new Set(((value ?? []) as string[]).map(text))];

export function prepareTaxonomy(source: SeedSource): Record<string, DictionaryItem[]> {
  const result = structuredClone(source.taxonomy);
  // Keep source labels without violating the current single-parent hierarchy.
  for (const test of source.BenchmarkTest) {
    for (const name of test.subGroups) {
      if (
        !result.SubGroup.some(
          (row) => key(row.name) === key(name) && key(row.macroGroup!) === key(test.macroGroup)
        )
      ) {
        const original = result.SubGroup.find((row) => key(row.name) === key(name));
        if (!original) throw new Error(`Unknown subgroup: ${name}`);
        result.SubGroup.push({ ...original, macroGroup: test.macroGroup });
      }
    }
    for (const name of test.featureLabels) {
      if (!result.Capability.some((row) => key(row.name) === key(name))) {
        result.Capability.push({ name: text(name), nameEn: text(name) });
      }
    }
  }
  return result;
}

function resolveId(maps: IdMaps, type: string, name: string, parent?: string): string {
  const id = maps[type]?.get(parent ? childKey(name, parent) : key(name));
  if (!id) throw new Error(`Unknown ${type}: ${name}${parent ? ` (${parent})` : ''}`);
  return id;
}

export function mapTest(test: SourceTest, suiteId: string, maps: IdMaps): CreateBenchmarkTestDto {
  if (test.subsets.length) throw new Error('This startup seed expects no DatasetSubsamples');
  if (!test.metrics.length) throw new Error(`Test has no metrics: ${test.name}`);
  const body: Record<string, unknown> = {
    suiteId,
    name: text(test.name),
    nameEn: text(test.nameEn),
    description: test.description || test.shortDescription || test.taskDescription,
    metrics: names(test.metrics),
    subGroupIds: names(test.subGroups).map((name) =>
      resolveId(maps, 'SubGroup', name, test.macroGroup)
    ),
    capabilityIds: names([...test.capabilities, ...test.featureLabels]).map((name) =>
      resolveId(maps, 'Capability', name)
    ),
    datasetSubsamples: [],
  };
  const fields = [
    'descriptionEn',
    'shortDescription',
    'taskDescription',
    'instructions',
    'instructionsEn',
    'confidenceScore',
    'confidentialityLevel',
    'knowledgeLevel',
    'importance',
    'importanceComment',
    'contextFieldFormat',
    'answerFieldFormat',
    'evaluationLogic',
    'humanBaseline',
    'humanBaselineNotes',
    'recommendedMetricsDescription',
    'requiredGigaChatQualityLevel',
    'sizeInSamples',
    'medianSampleSizeWords',
    'isDifficultyAutoCalculated',
    'difficultyCalculationComment',
    'gigaMetricsCodebaseUrl',
    'isGenerated',
    'jiraTicketId',
    'examples',
    'references',
    'links',
  ];
  for (const field of fields) {
    if (test[field] !== null && test[field] !== undefined)
      body[field] = structuredClone(test[field]);
  }
  for (const field of ['skills', 'abilityTags']) body[field] = names(test[field]);
  for (const [field, type] of Object.entries({
    macroGroup: 'MacroGroup',
    taskType: 'TaskType',
    language: 'Language',
    difficulty: 'Difficulty',
  })) {
    if (test[field]) body[`${field}Id`] = resolveId(maps, type, test[field] as string);
  }
  for (const [field, type, target] of [
    ['abilityTaxons', 'AbilityTaxon', 'abilityTaxonIds'],
    ['domains', 'Domain', 'domainIds'],
    ['modalities', 'Modality', 'modalityIds'],
  ])
    body[target] = names(test[field]).map((name) => resolveId(maps, type, name));
  body.subdomainIds = names(test.subdomains).map((name) => resolveId(maps, 'Subdomain', name));
  if (test.codebaseUrl)
    body.codebase = { name: test.codebaseName || undefined, url: test.codebaseUrl };
  for (const [oldField, field] of Object.entries({
    gigaMetricsAdapterName: 'gigaMetricAdapterName',
    gigaMetricsSetUrl: 'gigaMetricSetUrl',
    gigaMetricsLaunchCommand: 'gigaMetricLaunchCommand',
  }))
    if (test[oldField] != null) body[field] = test[oldField];
  for (const [prefix, field] of [
    ['request', 'requestLengthDist'],
    ['response', 'responseLengthDist'],
  ]) {
    const values = ['Min', 'Median', 'Max'].map((suffix) => test[`${prefix}Len${suffix}`]);
    if (values.some((value) => value != null)) {
      body[field] = { min: values[0] ?? 0, median: values[1] ?? 0, max: values[2] ?? 0 };
    }
  }
  const dto = plainToInstance(CreateBenchmarkTestDto, body);
  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length)
    throw new Error(
      `Invalid Test ${test.name}: ${JSON.stringify(errors, (_, v) => (_ === 'target' ? undefined : v))}`
    );
  return dto;
}

function localUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Startup seed is restricted to local HTTP endpoints');
  }
  return value.replace(/\/$/, '');
}

function seedOrigin(value: string): string {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'CATALOG_SEED_ORIGIN must be an HTTP(S) origin without credentials, path, query or hash'
    );
  }
  return url.origin;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  if (
    process.argv.slice(2).some((arg) => !['--apply', '--dry-run'].includes(arg)) ||
    (apply && process.argv.includes('--dry-run'))
  ) {
    throw new Error('Usage: npm run seed:catalog -- --dry-run | --apply');
  }
  const source: SeedSource = JSON.parse(
    readFileSync(join(__dirname, '../gigametrics_catalogue_q2_green.json'), 'utf8')
  );
  if (source.Benchmark.length !== 10 || source.BenchmarkTest.length !== 40)
    throw new Error('Unexpected startup dataset');
  const taxonomy = prepareTaxonomy(source);
  const maps: IdMaps = {};
  for (const [type] of dictionaries) {
    maps[type] = new Map(
      taxonomy[type].map((row) => [
        type === 'SubGroup' ? childKey(row.name, row.macroGroup!) : key(row.name),
        randomUUID(),
      ])
    );
  }
  for (const test of source.BenchmarkTest) {
    if (!source.Benchmark.some((row) => key(row.name) === key(test.benchmark)))
      throw new Error(`Unknown Benchmark: ${test.benchmark}`);
    mapTest(test, randomUUID(), maps);
  }
  console.log(
    `Validated: 10 Benchmarks, 40 Tests, ${dictionaries.reduce((sum, [type]) => sum + taxonomy[type].length, 0)} dictionary items, 9 Metrics`
  );
  const catalog = localUrl(process.env.CATALOG_SEED_URL ?? 'http://127.0.0.1:3000/api');
  const service = localUrl(
    process.env.BENCHMARK_SERVICE_SEED_URL ?? 'http://127.0.0.1:3100/api/v1'
  );
  if (!apply) {
    console.log('Dry run: no requests or writes');
    return;
  }
  let cookie = '';
  const origin = seedOrigin(process.env.CATALOG_SEED_ORIGIN ?? 'http://127.0.0.1:5173');
  async function request(base: string, path: string, method = 'GET', body?: unknown): Promise<any> {
    const response = await fetch(`${base}${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'Content-Type': 'application/json',
        ...(base === catalog ? { Cookie: cookie, Origin: origin } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new Error(`${method} ${path}: HTTP ${response.status} ${await response.text()}`);
    if (path === '/auth/login') cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
    const result = await response.text();
    return result ? JSON.parse(result) : undefined;
  }
  async function list(base: string, path: string): Promise<any[]> {
    const result: any[] = [];
    for (let page = 1; ; page++) {
      const response = await request(base, `${path}?page=${page}&limit=100`);
      result.push(...response.data);
      if (result.length >= response.total || response.data.length === 0) return result;
    }
  }
  async function command(path: string, body: unknown): Promise<string> {
    const receipt = await request(catalog, path, 'POST', body);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const status = await request(catalog, `/benchmark-operations/${receipt.operationId}`);
      if (status.status === 'applied') return receipt.aggregateId;
      if (status.status === 'rejected')
        throw new Error(`${path}: ${status.reasonCode} ${status.message}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Timed out; do not resubmit blindly. Inspect operation ${receipt.operationId}`);
  }
  await request(catalog, '/auth/login', 'POST', {
    username: process.env.ADMIN_LOGIN ?? 'admin',
    password: process.env.ADMIN_PASSWORD ?? 'admin1234!@$%',
  });
  // Read source identities rather than trusting any pre-extraction Catalog copies.
  const suites = await list(service, '/benchmarks');
  const tests = await list(service, '/tests');
  for (const [type, path] of dictionaries) {
    const existing: NamedId[] = await list(catalog, `/catalog/settings/${path}`);
    maps[type] = new Map();
    for (const item of taxonomy[type]) {
      const parentId =
        type === 'SubGroup'
          ? resolveId(maps, 'MacroGroup', item.macroGroup!)
          : type === 'Subdomain'
            ? resolveId(maps, 'Domain', item.domain!)
            : undefined;
      const parentField = type === 'SubGroup' ? 'macroGroupId' : 'domainId';
      let row = existing.find(
        (row) => key(row.name) === key(item.name) && (!parentId || row.parentId === parentId)
      );
      if (!row) {
        row = await request(catalog, `/catalog/settings/${path}`, 'POST', {
          name: text(item.name),
          nameEn: text(item.nameEn),
          ...(parentId ? { [parentField]: parentId } : {}),
        });
        existing.push(row!);
      }
      maps[type].set(
        type === 'SubGroup' ? childKey(item.name, item.macroGroup!) : key(item.name),
        row!.id
      );
    }
  }
  // Seed also the MetricDefinition that happens not to be assigned to any Test.
  const priorities = await request(catalog, '/metrics/lookups/priorities');
  const directions = await request(catalog, '/metrics/lookups/directions');
  const metrics: NamedId[] = await list(catalog, '/metrics');
  for (const item of taxonomy.MetricDefinition) {
    if (!metrics.some((row) => row.name === item.name)) {
      metrics.push(
        await request(catalog, '/metrics', 'POST', {
          name: item.name,
          displayName: item.nameEn,
          priorityId: priorities.find((row: any) => row.code === 'primary')?.id,
          directionId: directions.find((row: any) => row.code === 'higher_is_better')?.id,
        })
      );
    }
  }
  let createdSuites = 0;
  let createdTests = 0;
  for (const item of source.Benchmark) {
    let suite = suites.find((row) => key(row.name) === key(item.name));
    if (!suite) {
      const id = await command('/benchmarks', {
        ...item,
        name: text(item.name),
        nameEn: text(item.nameEn),
      });
      suite = await request(service, `/benchmarks/${id}`);
      suites.push(suite);
      createdSuites++;
    }
    for (const test of source.BenchmarkTest.filter(
      (row) => key(row.benchmark) === key(item.name)
    )) {
      const body = mapTest(test, suite.id, maps);
      const matches = tests.filter(
        (row) =>
          row.specification.suiteId === suite.id && key(row.specification.name) === key(test.name)
      );
      if (matches.length > 1) throw new Error(`Ambiguous existing Test: ${test.name}`);
      let stored = matches[0];
      if (!stored) {
        const id = await command('/benchmark-tests', body);
        stored = await request(service, `/tests/${id}`);
        tests.push(stored);
        createdTests++;
      } else stored = await request(service, `/tests/${stored.id}`);
      const expected = {
        ...JSON.parse(JSON.stringify(body)),
        metrics: undefined,
        metricIds: body.metrics!.map((name) => metrics.find((row) => row.name === name)!.id),
      };
      for (const [field, value] of Object.entries(expected)) {
        if (value !== undefined && !isDeepStrictEqual(stored.specification[field], value)) {
          throw new Error(
            `Existing/source Test differs in ${field}: ${test.name}. No automatic overwrite.`
          );
        }
      }
      const catalogTest = await request(catalog, `/benchmark-tests/management/${stored.id}`);
      if (catalogTest.validationStatus === 'rejected') {
        throw new Error(
          `Test was rejected by moderation: ${test.name}. Seed will not override that decision.`
        );
      }
      if (catalogTest.validationStatus !== 'published') {
        await request(catalog, `/catalog/entries/${stored.id}/moderation`, 'PATCH', {
          status: 'published',
        });
      }
      const visible = await request(catalog, `/benchmark-tests/${stored.id}`);
      if (visible.id !== stored.id || visible.name !== body.name)
        throw new Error(`Public Test is inconsistent: ${test.name}`);
      console.log(`Verified: ${test.name}`);
    }
  }
  console.log(
    `Seed complete: 40 public Tests verified; created ${createdSuites} Benchmarks and ${createdTests} Tests. Re-running does not overwrite Tests.`
  );
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
