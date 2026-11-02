export const BENCHMARK_CONTRACT_VERSION = 1 as const;

export const BENCHMARK_MESSAGE_TYPES = {
  suiteCreateRequested: 'benchmark.suite.create.requested.v1',
  suiteUpdateRequested: 'benchmark.suite.update.requested.v1',
  suiteDeleteRequested: 'benchmark.suite.delete.requested.v1',
  suiteRestoreRequested: 'benchmark.suite.restore.requested.v1',
  suiteSnapshot: 'benchmark.suite.snapshot.v1',
  suiteDeleted: 'benchmark.suite.deleted.v1',
  testCreateRequested: 'benchmark.test.create.requested.v1',
  testUpdateRequested: 'benchmark.test.update.requested.v1',
  testDeleteRequested: 'benchmark.test.delete.requested.v1',
  testRestoreRequested: 'benchmark.test.restore.requested.v1',
  testSpecificationLockRequested: 'benchmark.test.specification-lock.requested.v1',
  testSnapshot: 'benchmark.test.snapshot.v1',
  testDeleted: 'benchmark.test.deleted.v1',
  commandRejected: 'benchmark.command.rejected.v1',
} as const;

export const BENCHMARK_LINK_TYPES = [
  'obs',
  'gitverse',
  'github',
  'docs',
  'dataset',
  'score_racoon',
  'giga_metrics',
  'other',
] as const;

export type BenchmarkMessageType =
  (typeof BENCHMARK_MESSAGE_TYPES)[keyof typeof BENCHMARK_MESSAGE_TYPES];

export type BenchmarkAggregateType = 'benchmark' | 'test';

export type BenchmarkMessageEnvelopeV1<
  TType extends BenchmarkMessageType,
  TData,
  TAggregateType extends BenchmarkAggregateType = 'test'
> = Readonly<{
  eventId: string;
  eventType: TType;
  eventVersion: typeof BENCHMARK_CONTRACT_VERSION;
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  producer: 'benchmark-catalog' | 'benchmark-service';
  aggregateType: TAggregateType;
  aggregateId: string;
  aggregateVersion: number;
  data: Readonly<TData>;
}>;

export type BenchmarkLengthDistributionV1 = Readonly<{
  min: number;
  median: number;
  max: number;
}>;

export type BenchmarkExampleV1 = Readonly<{
  input: string;
  output: string;
  explanation?: string;
}>;

export type DatasetSubsampleV1 = Readonly<{
  id: string;
  name: string;
  nameEn: string;
  description?: string;
  split?: string;
  sizeInSamples: number;
  medianSampleSizeWords: number;
  requestLengthDist: BenchmarkLengthDistributionV1;
  responseLengthDist: BenchmarkLengthDistributionV1;
  examples: readonly BenchmarkExampleV1[];
}>;

export type BenchmarkTestSpecificationV1 = Readonly<{
  suiteId: string;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn?: string;
  shortDescription?: string;
  taskDescription?: string;
  instructions?: string;
  instructionsEn?: string;
  codebase?: Readonly<{ name?: string; url: string }> | null;
  macroGroupId?: string | null;
  subGroupIds: readonly string[];
  abilityTaxonIds: readonly string[];
  taskTypeId?: string | null;
  modalityIds: readonly string[];
  languageId?: string | null;
  difficultyId?: string | null;
  capabilityIds: readonly string[];
  domainIds: readonly string[];
  subdomainIds: readonly string[];
  abilityTags: readonly string[];
  skills: readonly string[];
  metricIds: readonly string[];
  examples: readonly BenchmarkExampleV1[];
  datasetSubsamples: readonly DatasetSubsampleV1[];
  references: readonly Readonly<{ title: string; url: string }>[];
  links: readonly Readonly<{ type: string; title: string; url: string }>[];
  sizeInSamples: number;
  medianSampleSizeWords: number;
  requestLengthDist: BenchmarkLengthDistributionV1;
  responseLengthDist: BenchmarkLengthDistributionV1;
  isDifficultyAutoCalculated: boolean;
  difficultyCalculationComment?: string;
  confidenceScore?: number;
  confidentialityLevel?: string;
  knowledgeLevel?: string;
  importance?: string;
  importanceComment?: string;
  contextFieldFormat?: string;
  answerFieldFormat?: string;
  evaluationLogic?: string;
  humanBaseline?: number;
  humanBaselineNotes?: string;
  recommendedMetricsDescription?: string;
  requiredGigaChatQualityLevel?: string;
  gigaMetricAdapterName?: string;
  gigaMetricSetUrl?: string;
  gigaMetricLaunchCommand?: string;
  gigaMetricsCodebaseUrl?: string;
  isGenerated: boolean;
  jiraTicketId?: string;
  generatedAt?: string;
}>;

export type BenchmarkSuiteSpecificationV1 = Readonly<{
  name: string;
  nameEn: string;
  description: string | null;
  descriptionEn: string | null;
}>;

export type BenchmarkTestSnapshotV1 = Readonly<{
  id: string;
  aggregateVersion: number;
  specification: BenchmarkTestSpecificationV1;
  specificationLockedAt: string | null;
  specificationLockReason: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}>;

export type BenchmarkSuiteSnapshotV1 = Readonly<{
  id: string;
  aggregateVersion: number;
  name: string;
  nameEn: string;
  description?: string;
  descriptionEn?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}>;

export type BenchmarkSuiteSnapshotEventV1 = BenchmarkMessageEnvelopeV1<
  typeof BENCHMARK_MESSAGE_TYPES.suiteSnapshot,
  { benchmark: BenchmarkSuiteSnapshotV1 },
  'benchmark'
>;

export type BenchmarkSuiteDeletedEventV1 = BenchmarkMessageEnvelopeV1<
  typeof BENCHMARK_MESSAGE_TYPES.suiteDeleted,
  { benchmarkId: string; deletedAt: string },
  'benchmark'
>;

export type BenchmarkSuiteCreateRequestedV1 = BenchmarkMessageEnvelopeV1<
  typeof BENCHMARK_MESSAGE_TYPES.suiteCreateRequested,
  { benchmarkId: string; specification: BenchmarkSuiteSpecificationV1 },
  'benchmark'
>;

export type BenchmarkSuiteUpdateRequestedV1 = BenchmarkMessageEnvelopeV1<
  typeof BENCHMARK_MESSAGE_TYPES.suiteUpdateRequested,
  {
    benchmarkId: string;
    expectedAggregateVersion: number;
    specification: BenchmarkSuiteSpecificationV1;
  },
  'benchmark'
>;

export type BenchmarkSuiteLifecycleRequestedV1 = BenchmarkMessageEnvelopeV1<
  | typeof BENCHMARK_MESSAGE_TYPES.suiteDeleteRequested
  | typeof BENCHMARK_MESSAGE_TYPES.suiteRestoreRequested,
  { benchmarkId: string; expectedAggregateVersion: number },
  'benchmark'
>;

export type BenchmarkTestCreateRequestedV1 = BenchmarkMessageEnvelopeV1<
  typeof BENCHMARK_MESSAGE_TYPES.testCreateRequested,
  {
    testId: string;
    specification: BenchmarkTestSpecificationV1;
  }
>;

export type BenchmarkTestUpdateRequestedV1 = BenchmarkMessageEnvelopeV1<
  typeof BENCHMARK_MESSAGE_TYPES.testUpdateRequested,
  {
    testId: string;
    expectedAggregateVersion: number;
    specification: BenchmarkTestSpecificationV1;
  }
>;

export type BenchmarkTestLifecycleRequestedV1 = BenchmarkMessageEnvelopeV1<
  | typeof BENCHMARK_MESSAGE_TYPES.testDeleteRequested
  | typeof BENCHMARK_MESSAGE_TYPES.testRestoreRequested,
  {
    testId: string;
    expectedAggregateVersion: number;
  }
>;

export type BenchmarkTestSpecificationLockRequestedV1 = BenchmarkMessageEnvelopeV1<
  typeof BENCHMARK_MESSAGE_TYPES.testSpecificationLockRequested,
  {
    testId: string;
    sourceEventId: string;
    reason: string;
  }
>;

export type BenchmarkTestSnapshotEventV1 = BenchmarkMessageEnvelopeV1<
  typeof BENCHMARK_MESSAGE_TYPES.testSnapshot,
  { test: BenchmarkTestSnapshotV1 }
>;

export type BenchmarkTestDeletedEventV1 = BenchmarkMessageEnvelopeV1<
  typeof BENCHMARK_MESSAGE_TYPES.testDeleted,
  { testId: string; deletedAt: string }
>;

export type BenchmarkCommandRejectedEventV1 = BenchmarkMessageEnvelopeV1<
  typeof BENCHMARK_MESSAGE_TYPES.commandRejected,
  {
    commandEventId: string;
    reasonCode: string;
    message: string;
    statusCode?: 400 | 404 | 409;
    deletedId?: string;
  },
  BenchmarkAggregateType
>;

export type BenchmarkIntegrationMessageV1 =
  | BenchmarkSuiteCreateRequestedV1
  | BenchmarkSuiteUpdateRequestedV1
  | BenchmarkSuiteLifecycleRequestedV1
  | BenchmarkSuiteSnapshotEventV1
  | BenchmarkSuiteDeletedEventV1
  | BenchmarkTestCreateRequestedV1
  | BenchmarkTestUpdateRequestedV1
  | BenchmarkTestLifecycleRequestedV1
  | BenchmarkTestSpecificationLockRequestedV1
  | BenchmarkTestSnapshotEventV1
  | BenchmarkTestDeletedEventV1
  | BenchmarkCommandRejectedEventV1;

const ENVELOPE_KEYS = new Set([
  'eventId',
  'eventType',
  'eventVersion',
  'occurredAt',
  'correlationId',
  'causationId',
  'producer',
  'aggregateType',
  'aggregateId',
  'aggregateVersion',
  'data',
]);

const SPECIFICATION_KEYS = new Set<keyof BenchmarkTestSpecificationV1>([
  'suiteId',
  'name',
  'nameEn',
  'description',
  'descriptionEn',
  'shortDescription',
  'taskDescription',
  'instructions',
  'instructionsEn',
  'codebase',
  'macroGroupId',
  'subGroupIds',
  'abilityTaxonIds',
  'taskTypeId',
  'modalityIds',
  'languageId',
  'difficultyId',
  'capabilityIds',
  'domainIds',
  'subdomainIds',
  'abilityTags',
  'skills',
  'metricIds',
  'examples',
  'datasetSubsamples',
  'references',
  'links',
  'sizeInSamples',
  'medianSampleSizeWords',
  'requestLengthDist',
  'responseLengthDist',
  'isDifficultyAutoCalculated',
  'difficultyCalculationComment',
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
  'gigaMetricAdapterName',
  'gigaMetricSetUrl',
  'gigaMetricLaunchCommand',
  'gigaMetricsCodebaseUrl',
  'isGenerated',
  'jiraTicketId',
  'generatedAt',
]);

const SUBSAMPLE_KEYS = new Set<keyof DatasetSubsampleV1>([
  'id',
  'name',
  'nameEn',
  'description',
  'split',
  'sizeInSamples',
  'medianSampleSizeWords',
  'requestLengthDist',
  'responseLengthDist',
  'examples',
]);

const MESSAGE_TYPES = new Set<string>(Object.values(BENCHMARK_MESSAGE_TYPES));
const LINK_TYPES = new Set<string>(BENCHMARK_LINK_TYPES);
const COMMAND_MESSAGE_TYPES = new Set<string>([
  BENCHMARK_MESSAGE_TYPES.suiteCreateRequested,
  BENCHMARK_MESSAGE_TYPES.suiteUpdateRequested,
  BENCHMARK_MESSAGE_TYPES.suiteDeleteRequested,
  BENCHMARK_MESSAGE_TYPES.suiteRestoreRequested,
  BENCHMARK_MESSAGE_TYPES.testCreateRequested,
  BENCHMARK_MESSAGE_TYPES.testUpdateRequested,
  BENCHMARK_MESSAGE_TYPES.testDeleteRequested,
  BENCHMARK_MESSAGE_TYPES.testRestoreRequested,
  BENCHMARK_MESSAGE_TYPES.testSpecificationLockRequested,
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseBenchmarkIntegrationMessageV1(value: unknown): BenchmarkIntegrationMessageV1 {
  const envelope = requireObject(value, 'message');
  requireExactKeys(envelope, ENVELOPE_KEYS, 'message');

  const eventType = requireString(envelope.eventType, 'message.eventType');
  if (!MESSAGE_TYPES.has(eventType)) {
    fail(`message.eventType is unsupported: "${eventType}"`);
  }
  if (BENCHMARK_CONTRACT_VERSION !== envelope.eventVersion) {
    fail('message.eventVersion must be 1');
  }

  requireUuid(envelope.eventId, 'message.eventId');
  requireIsoDate(envelope.occurredAt, 'message.occurredAt');
  requireUuid(envelope.correlationId, 'message.correlationId');
  if (null !== envelope.causationId) {
    requireUuid(envelope.causationId, 'message.causationId');
  }
  const expectedProducer = COMMAND_MESSAGE_TYPES.has(eventType)
    ? 'benchmark-catalog'
    : 'benchmark-service';
  if (expectedProducer !== envelope.producer) {
    fail(`message.producer must be "${expectedProducer}" for "${eventType}"`);
  }
  if (!['benchmark', 'test'].includes(String(envelope.aggregateType))) {
    fail('message.aggregateType is unsupported');
  }
  const aggregateId = requireUuid(envelope.aggregateId, 'message.aggregateId');
  const aggregateVersion = requirePositiveInteger(
    envelope.aggregateVersion,
    'message.aggregateVersion'
  );
  const data = requireObject(envelope.data, 'message.data');

  assertData(eventType as BenchmarkMessageType, data, {
    aggregateType: envelope.aggregateType as BenchmarkAggregateType,
    aggregateId,
    aggregateVersion,
    causationId: envelope.causationId as string | null,
  });

  return value as BenchmarkIntegrationMessageV1;
}

export function parseBenchmarkTestSnapshotV1(
  value: unknown
): BenchmarkTestSnapshotV1 {
  const test = requireObject(value, 'BenchmarkTestSnapshotV1');
  requireExactKeys(
    test,
    new Set([
      'id',
      'aggregateVersion',
      'specification',
      'specificationLockedAt',
      'specificationLockReason',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ]),
    'BenchmarkTestSnapshotV1'
  );
  requireUuid(test.id, 'BenchmarkTestSnapshotV1.id');
  requirePositiveInteger(
    test.aggregateVersion,
    'BenchmarkTestSnapshotV1.aggregateVersion'
  );
  if (null !== test.specificationLockedAt) {
    requireIsoDate(
      test.specificationLockedAt,
      'BenchmarkTestSnapshotV1.specificationLockedAt'
    );
  }
  if (null !== test.specificationLockReason) {
    requireNonEmptyString(
      test.specificationLockReason,
      'BenchmarkTestSnapshotV1.specificationLockReason'
    );
  }
  if (
    (null === test.specificationLockedAt) !==
    (null === test.specificationLockReason)
  ) {
    fail(
      'BenchmarkTestSnapshotV1 specification lock timestamp and reason must both be null or both be set'
    );
  }
  requireIsoDate(test.createdAt, 'BenchmarkTestSnapshotV1.createdAt');
  requireIsoDate(test.updatedAt, 'BenchmarkTestSnapshotV1.updatedAt');
  if (null !== test.deletedAt) {
    requireIsoDate(test.deletedAt, 'BenchmarkTestSnapshotV1.deletedAt');
  }
  assertSpecification(
    test.specification,
    'BenchmarkTestSnapshotV1.specification'
  );
  return value as BenchmarkTestSnapshotV1;
}

function assertData(
  eventType: BenchmarkMessageType,
  data: Record<string, unknown>,
  aggregate: {
    aggregateType: BenchmarkAggregateType;
    aggregateId: string;
    aggregateVersion: number;
    causationId: string | null;
  }
): void {
  const suiteLifecycle =
    BENCHMARK_MESSAGE_TYPES.suiteDeleteRequested === eventType ||
    BENCHMARK_MESSAGE_TYPES.suiteRestoreRequested === eventType;
  if (suiteLifecycle) {
    requireBenchmarkAggregate(aggregate.aggregateType);
    requireExactKeys(data, new Set(['benchmarkId', 'expectedAggregateVersion']), 'message.data');
    requireMatchingAggregateId(data.benchmarkId, aggregate.aggregateId, 'message.data.benchmarkId');
    requireExpectedVersion(data.expectedAggregateVersion, aggregate);
    return;
  }

  const suiteCreate = BENCHMARK_MESSAGE_TYPES.suiteCreateRequested === eventType;
  const suiteUpdate = BENCHMARK_MESSAGE_TYPES.suiteUpdateRequested === eventType;
  if (suiteCreate || suiteUpdate) {
    requireBenchmarkAggregate(aggregate.aggregateType);
    requireExactKeys(
      data,
      new Set([
        'benchmarkId',
        ...(suiteUpdate ? ['expectedAggregateVersion'] : []),
        'specification',
      ]),
      'message.data'
    );
    requireMatchingAggregateId(data.benchmarkId, aggregate.aggregateId, 'message.data.benchmarkId');
    if (suiteCreate && 1 !== aggregate.aggregateVersion) {
      fail('message.aggregateVersion must be 1 for a create command');
    }
    if (suiteUpdate) {
      requireExpectedVersion(data.expectedAggregateVersion, aggregate);
    }
    assertSuiteSpecification(data.specification, 'message.data.specification');
    return;
  }

  if (BENCHMARK_MESSAGE_TYPES.suiteSnapshot === eventType) {
    requireBenchmarkAggregate(aggregate.aggregateType);
    requireExactKeys(data, new Set(['benchmark']), 'message.data');
    const benchmark = requireObject(data.benchmark, 'message.data.benchmark');
    requireExactKeys(
      benchmark,
      new Set([
        'id',
        'aggregateVersion',
        'name',
        'nameEn',
        'description',
        'descriptionEn',
        'createdAt',
        'updatedAt',
        'deletedAt',
      ]),
      'message.data.benchmark'
    );
    requireMatchingAggregateId(benchmark.id, aggregate.aggregateId, 'message.data.benchmark.id');
    if (aggregate.aggregateVersion !== benchmark.aggregateVersion) {
      fail('message.data.benchmark.aggregateVersion must match envelope aggregateVersion');
    }
    requireNonEmptyString(benchmark.name, 'message.data.benchmark.name');
    requireNonEmptyString(benchmark.nameEn, 'message.data.benchmark.nameEn');
    requireOptionalString(benchmark.description, 'message.data.benchmark.description');
    requireOptionalString(benchmark.descriptionEn, 'message.data.benchmark.descriptionEn');
    requireIsoDate(benchmark.createdAt, 'message.data.benchmark.createdAt');
    requireIsoDate(benchmark.updatedAt, 'message.data.benchmark.updatedAt');
    if (null !== benchmark.deletedAt) {
      requireIsoDate(benchmark.deletedAt, 'message.data.benchmark.deletedAt');
    }
    return;
  }

  if (BENCHMARK_MESSAGE_TYPES.suiteDeleted === eventType) {
    requireBenchmarkAggregate(aggregate.aggregateType);
    requireExactKeys(data, new Set(['benchmarkId', 'deletedAt']), 'message.data');
    requireMatchingAggregateId(data.benchmarkId, aggregate.aggregateId, 'message.data.benchmarkId');
    requireIsoDate(data.deletedAt, 'message.data.deletedAt');
    return;
  }

  if (BENCHMARK_MESSAGE_TYPES.commandRejected === eventType) {
    requireExactKeys(
      data,
      new Set([
        'commandEventId',
        'reasonCode',
        'message',
        'statusCode',
        'deletedId',
      ]),
      'message.data'
    );
    requireUuid(data.commandEventId, 'message.data.commandEventId');
    if (data.commandEventId !== aggregate.causationId) {
      fail('message.causationId must equal message.data.commandEventId for a rejection');
    }
    requireNonEmptyString(data.reasonCode, 'message.data.reasonCode');
    requireNonEmptyString(data.message, 'message.data.message');
    if (
      undefined !== data.statusCode &&
      ![400, 404, 409].includes(Number(data.statusCode))
    ) {
      fail('message.data.statusCode must be 400, 404 or 409 when provided');
    }
    if (undefined !== data.deletedId) {
      requireUuid(data.deletedId, 'message.data.deletedId');
    }
    return;
  }

  if ('test' !== aggregate.aggregateType) {
    fail('message.aggregateType must be "test" for a Test message');
  }

  if (BENCHMARK_MESSAGE_TYPES.testSnapshot === eventType) {
    requireExactKeys(data, new Set(['test']), 'message.data');
    const test = parseBenchmarkTestSnapshotV1(data.test);
    requireMatchingTestId(test.id, aggregate.aggregateId, 'message.data.test.id');
    if (aggregate.aggregateVersion !== test.aggregateVersion) {
      fail('message.data.test.aggregateVersion must match envelope aggregateVersion');
    }
    return;
  }

  if (BENCHMARK_MESSAGE_TYPES.testDeleted === eventType) {
    requireExactKeys(data, new Set(['testId', 'deletedAt']), 'message.data');
    requireMatchingTestId(data.testId, aggregate.aggregateId, 'message.data.testId');
    requireIsoDate(data.deletedAt, 'message.data.deletedAt');
    return;
  }

  if (BENCHMARK_MESSAGE_TYPES.testSpecificationLockRequested === eventType) {
    requireExactKeys(data, new Set(['testId', 'sourceEventId', 'reason']), 'message.data');
    requireMatchingTestId(data.testId, aggregate.aggregateId, 'message.data.testId');
    requireUuid(data.sourceEventId, 'message.data.sourceEventId');
    requireNonEmptyString(data.reason, 'message.data.reason');
    return;
  }

  const lifecycle =
    BENCHMARK_MESSAGE_TYPES.testDeleteRequested === eventType ||
    BENCHMARK_MESSAGE_TYPES.testRestoreRequested === eventType;
  if (lifecycle) {
    requireExactKeys(data, new Set(['testId', 'expectedAggregateVersion']), 'message.data');
    requireMatchingTestId(data.testId, aggregate.aggregateId, 'message.data.testId');
    requireExpectedVersion(data.expectedAggregateVersion, aggregate);
    return;
  }

  const update = BENCHMARK_MESSAGE_TYPES.testUpdateRequested === eventType;
  requireExactKeys(
    data,
    new Set(['testId', ...(update ? ['expectedAggregateVersion'] : []), 'specification']),
    'message.data'
  );
  requireMatchingTestId(data.testId, aggregate.aggregateId, 'message.data.testId');
  if (update) {
    requireExpectedVersion(data.expectedAggregateVersion, aggregate);
  } else if (1 !== aggregate.aggregateVersion) {
    fail('message.aggregateVersion must be 1 for a create command');
  }
  assertSpecification(data.specification, 'message.data.specification');
}

function assertSuiteSpecification(value: unknown, path: string): void {
  const specification = requireObject(value, path);
  requireExactKeys(
    specification,
    new Set(['name', 'nameEn', 'description', 'descriptionEn']),
    path
  );
  const name = requireNonEmptyString(specification.name, `${path}.name`);
  const nameEn = requireNonEmptyString(specification.nameEn, `${path}.nameEn`);
  requireMaxLength(name, 500, `${path}.name`);
  requireMaxLength(nameEn, 500, `${path}.nameEn`);
  for (const field of ['description', 'descriptionEn'] as const) {
    if (null !== specification[field]) {
      requireString(specification[field], `${path}.${field}`);
    }
  }
}

function requireExpectedVersion(value: unknown, aggregate: { aggregateVersion: number }): void {
  const version = requirePositiveInteger(value, 'message.data.expectedAggregateVersion');
  if (version !== aggregate.aggregateVersion) {
    fail('message.data.expectedAggregateVersion must match envelope aggregateVersion');
  }
}

function assertSpecification(value: unknown, path: string): void {
  const specification = requireObject(value, path);
  requireExactKeys(specification, SPECIFICATION_KEYS, path);

  requireUuid(specification.suiteId, `${path}.suiteId`);
  for (const field of ['name', 'nameEn', 'description'] as const) {
    const text = requireNonEmptyString(
      specification[field],
      `${path}.${field}`
    );
    if ('description' !== field) {
      requireMaxLength(text, 500, `${path}.${field}`);
    }
  }

  for (const field of [
    'descriptionEn',
    'shortDescription',
    'taskDescription',
    'instructions',
    'instructionsEn',
    'confidentialityLevel',
    'knowledgeLevel',
    'importance',
    'importanceComment',
    'contextFieldFormat',
    'answerFieldFormat',
    'evaluationLogic',
    'humanBaselineNotes',
    'recommendedMetricsDescription',
    'requiredGigaChatQualityLevel',
    'gigaMetricAdapterName',
    'gigaMetricSetUrl',
    'gigaMetricLaunchCommand',
    'gigaMetricsCodebaseUrl',
    'jiraTicketId',
    'difficultyCalculationComment',
  ] as const) {
    requireOptionalString(specification[field], `${path}.${field}`);
  }
  if (specification.generatedAt !== undefined) {
    requireIsoDate(specification.generatedAt, `${path}.generatedAt`);
  }

  for (const field of ['macroGroupId', 'taskTypeId', 'languageId', 'difficultyId'] as const) {
    requireOptionalNullableUuid(specification[field], `${path}.${field}`);
  }

  for (const field of [
    'subGroupIds',
    'abilityTaxonIds',
    'modalityIds',
    'capabilityIds',
    'domainIds',
    'subdomainIds',
    'metricIds',
  ] as const) {
    requireUuidArray(specification[field], `${path}.${field}`);
  }
  for (const field of ['abilityTags', 'skills'] as const) {
    requireNonEmptyStringArray(specification[field], `${path}.${field}`, 255);
  }

  requireNonNegativeInteger(specification.sizeInSamples, `${path}.sizeInSamples`);
  requireNonNegativeInteger(specification.medianSampleSizeWords, `${path}.medianSampleSizeWords`);
  requireOptionalFiniteNumber(specification.confidenceScore, `${path}.confidenceScore`);
  requireOptionalFiniteNumber(specification.humanBaseline, `${path}.humanBaseline`);
  assertDistribution(specification.requestLengthDist, `${path}.requestLengthDist`);
  assertDistribution(specification.responseLengthDist, `${path}.responseLengthDist`);

  if ('boolean' !== typeof specification.isGenerated) {
    fail(`${path}.isGenerated must be a boolean`);
  }
  if ('boolean' !== typeof specification.isDifficultyAutoCalculated) {
    fail(`${path}.isDifficultyAutoCalculated must be a boolean`);
  }

  assertExamples(specification.examples, `${path}.examples`);
  assertSubsamples(specification.datasetSubsamples, `${path}.datasetSubsamples`);
  assertTitledUrls(specification.references, `${path}.references`, false);
  assertTitledUrls(specification.links, `${path}.links`, true);

  if (specification.codebase !== undefined && null !== specification.codebase) {
    const codebase = requireObject(specification.codebase, `${path}.codebase`);
    requireExactKeys(codebase, new Set(['name', 'url']), `${path}.codebase`);
    requireOptionalString(codebase.name, `${path}.codebase.name`);
    requireOptionalMaxLength(codebase.name, 255, `${path}.codebase.name`);
    requireUrl(codebase.url, `${path}.codebase.url`);
  }
}

function assertSubsamples(value: unknown, path: string): void {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  const ids = new Set<string>();
  for (const [index, item] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    const subsample = requireObject(item, itemPath);
    requireExactKeys(subsample, SUBSAMPLE_KEYS, itemPath);
    const id = requireUuid(subsample.id, `${itemPath}.id`);
    if (ids.has(id)) fail(`${path} must not contain duplicate ids`);
    ids.add(id);
    const name = requireNonEmptyString(subsample.name, `${itemPath}.name`);
    const nameEn = requireNonEmptyString(subsample.nameEn, `${itemPath}.nameEn`);
    requireMaxLength(name, 500, `${itemPath}.name`);
    requireMaxLength(nameEn, 500, `${itemPath}.nameEn`);
    requireOptionalString(subsample.description, `${itemPath}.description`);
    requireOptionalString(subsample.split, `${itemPath}.split`);
    requireOptionalMaxLength(subsample.split, 120, `${itemPath}.split`);
    requireNonNegativeInteger(subsample.sizeInSamples, `${itemPath}.sizeInSamples`);
    requireNonNegativeInteger(subsample.medianSampleSizeWords, `${itemPath}.medianSampleSizeWords`);
    assertDistribution(subsample.requestLengthDist, `${itemPath}.requestLengthDist`);
    assertDistribution(subsample.responseLengthDist, `${itemPath}.responseLengthDist`);
    assertExamples(subsample.examples, `${itemPath}.examples`);
  }
}

function assertDistribution(value: unknown, path: string): void {
  const distribution = requireObject(value, path);
  requireExactKeys(distribution, new Set(['min', 'median', 'max']), path);
  const min = requireNonNegativeInteger(distribution.min, `${path}.min`);
  const median = requireNonNegativeInteger(distribution.median, `${path}.median`);
  const max = requireNonNegativeInteger(distribution.max, `${path}.max`);
  if (min > median || median > max) {
    fail(`${path} must satisfy min <= median <= max`);
  }
}

function assertExamples(value: unknown, path: string): void {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  for (const [index, item] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    const example = requireObject(item, itemPath);
    requireExactKeys(example, new Set(['input', 'output', 'explanation']), itemPath);
    requireNonEmptyString(example.input, `${itemPath}.input`);
    requireString(example.output, `${itemPath}.output`);
    requireOptionalString(example.explanation, `${itemPath}.explanation`);
  }
}

function assertTitledUrls(value: unknown, path: string, includeType: boolean): void {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  for (const [index, item] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    const link = requireObject(item, itemPath);
    requireExactKeys(
      link,
      new Set(includeType ? ['type', 'title', 'url'] : ['title', 'url']),
      itemPath
    );
    if (includeType) {
      const type = requireNonEmptyString(link.type, `${itemPath}.type`);
      if (!LINK_TYPES.has(type)) fail(`${itemPath}.type is unsupported`);
    }
    const title = requireNonEmptyString(link.title, `${itemPath}.title`);
    requireMaxLength(title, 500, `${itemPath}.title`);
    requireUrl(link.url, `${itemPath}.url`);
  }
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) {
    fail(`${path} contains unsupported fields: ${unknown.join(', ')}`);
  }
}

function requireString(value: unknown, path: string): string {
  if ('string' !== typeof value) fail(`${path} must be a string`);
  return value;
}

function requireNonEmptyString(value: unknown, path: string): string {
  const result = requireString(value, path);
  if (!result.trim()) fail(`${path} must not be empty`);
  return result;
}

function requireMaxLength(value: string, max: number, path: string): void {
  if (value.length > max) fail(`${path} must be at most ${max} characters`);
}

function requireOptionalString(value: unknown, path: string): void {
  if (undefined !== value && 'string' !== typeof value) {
    fail(`${path} must be a string when provided`);
  }
}

function requireOptionalMaxLength(
  value: unknown,
  max: number,
  path: string
): void {
  if ('string' === typeof value) requireMaxLength(value, max, path);
}

function requireOptionalNullableUuid(value: unknown, path: string): void {
  if (undefined !== value && null !== value) requireUuid(value, path);
}

function requireOptionalFiniteNumber(value: unknown, path: string): void {
  if (undefined !== value && ('number' !== typeof value || !Number.isFinite(value))) {
    fail(`${path} must be a finite number when provided`);
  }
}

function requireUuid(value: unknown, path: string): string {
  const result = requireString(value, path);
  if (!UUID_PATTERN.test(result)) fail(`${path} must be a UUID`);
  return result;
}

function requireMatchingTestId(value: unknown, aggregateId: string, path: string): void {
  if (requireUuid(value, path) !== aggregateId) {
    fail(`${path} must match envelope aggregateId`);
  }
}

function requireMatchingAggregateId(value: unknown, aggregateId: string, path: string): void {
  if (requireUuid(value, path) !== aggregateId) {
    fail(`${path} must match envelope aggregateId`);
  }
}

function requireBenchmarkAggregate(value: BenchmarkAggregateType): void {
  if ('benchmark' !== value) {
    fail('message.aggregateType must be "benchmark" for a Benchmark message');
  }
}

function requirePositiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    fail(`${path} must be a positive integer`);
  }
  return Number(value);
}

function requireNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    fail(`${path} must be a non-negative integer`);
  }
  return Number(value);
}

function requireNonEmptyStringArray(
  value: unknown,
  path: string,
  maxLength: number
): void {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  const items = value.map((item, index) => {
    const result = requireNonEmptyString(item, `${path}[${index}]`);
    requireMaxLength(result, maxLength, `${path}[${index}]`);
    return result;
  });
  if (new Set(items).size !== items.length) {
    fail(`${path} must not contain duplicates`);
  }
}

function requireUuidArray(value: unknown, path: string): void {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  const ids = value.map((item, index) => requireUuid(item, `${path}[${index}]`));
  if (new Set(ids).size !== ids.length) {
    fail(`${path} must not contain duplicate ids`);
  }
}

function requireIsoDate(value: unknown, path: string): void {
  const date = requireString(value, path);
  const isoWithOffset =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
  if (!isoWithOffset.test(date) || Number.isNaN(Date.parse(date))) {
    fail(`${path} must be an ISO 8601 timestamp with an explicit offset`);
  }
}

function requireUrl(value: unknown, path: string): void {
  const url = requireString(value, path);
  requireMaxLength(url, 2_000, path);
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch {
    fail(`${path} must be an HTTP(S) URL`);
  }
}

function fail(message: string): never {
  throw new Error(`Invalid Benchmark integration contract v1: ${message}`);
}
