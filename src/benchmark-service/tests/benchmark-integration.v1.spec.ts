import {
  BENCHMARK_MESSAGE_TYPES,
  parseBenchmarkIntegrationMessageV1,
} from '../contracts/benchmark-integration.v1';

const IDS = {
  event: '11111111-1111-4111-8111-111111111111',
  correlation: '22222222-2222-4222-8222-222222222222',
  causation: '33333333-3333-4333-8333-333333333333',
  test: '44444444-4444-4444-8444-444444444444',
  suite: '55555555-5555-4555-8555-555555555555',
  metric: '66666666-6666-4666-8666-666666666666',
  subsample: '77777777-7777-4777-8777-777777777777',
};

const distribution = { min: 1, median: 2, max: 3 };

const specification = {
  suiteId: IDS.suite,
  name: 'Тест',
  nameEn: 'Test',
  description: 'Description',
  codebase: { name: 'repo', url: 'https://example.test/repo' },
  subGroupIds: [],
  abilityTaxonIds: [],
  modalityIds: [],
  capabilityIds: [],
  domainIds: [],
  subdomainIds: [],
  abilityTags: [],
  skills: [],
  metricIds: [IDS.metric],
  examples: [{ input: 'question', output: 'answer' }],
  datasetSubsamples: [
    {
      id: IDS.subsample,
      name: 'public',
      nameEn: 'public',
      split: 'test',
      sizeInSamples: 10,
      medianSampleSizeWords: 20,
      requestLengthDist: distribution,
      responseLengthDist: distribution,
      examples: [{ input: 'sub-question', output: 'sub-answer' }],
    },
  ],
  references: [{ title: 'Paper', url: 'https://example.test/paper' }],
  links: [{ type: 'dataset', title: 'Dataset', url: 'https://example.test/data' }],
  sizeInSamples: 10,
  medianSampleSizeWords: 20,
  requestLengthDist: distribution,
  responseLengthDist: distribution,
  isDifficultyAutoCalculated: false,
  evaluationLogic: 'exact match',
  humanBaseline: 0.95,
  gigaMetricAdapterName: 'exact-match',
  isGenerated: false,
  generatedAt: '2026-09-07T09:00:00.000Z',
};

function envelope(eventType: string, data: object) {
  const create =
    BENCHMARK_MESSAGE_TYPES.testCreateRequested === eventType ||
    BENCHMARK_MESSAGE_TYPES.suiteCreateRequested === eventType;
  const requested = eventType.includes('.requested.');
  const rejection = BENCHMARK_MESSAGE_TYPES.commandRejected === eventType;
  return {
    eventId: IDS.event,
    eventType,
    eventVersion: 1,
    occurredAt: '2026-09-07T12:00:00.000Z',
    correlationId: IDS.correlation,
    causationId: rejection ? (data as { commandEventId: string }).commandEventId : IDS.causation,
    producer: requested ? 'benchmark-catalog' : 'benchmark-service',
    aggregateType: 'test',
    aggregateId: IDS.test,
    aggregateVersion: create ? 1 : 3,
    data,
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('Benchmark integration contract v1', () => {
  it.each([
    [
      BENCHMARK_MESSAGE_TYPES.suiteCreateRequested,
      {
        benchmarkId: IDS.suite,
        specification: {
          name: 'Группа',
          nameEn: 'Suite',
          description: null,
          descriptionEn: null,
        },
      },
    ],
    [
      BENCHMARK_MESSAGE_TYPES.suiteUpdateRequested,
      {
        benchmarkId: IDS.suite,
        expectedAggregateVersion: 3,
        specification: {
          name: 'Группа 2',
          nameEn: 'Suite 2',
          description: null,
          descriptionEn: null,
        },
      },
    ],
    [
      BENCHMARK_MESSAGE_TYPES.suiteDeleteRequested,
      { benchmarkId: IDS.suite, expectedAggregateVersion: 3 },
    ],
    [
      BENCHMARK_MESSAGE_TYPES.suiteRestoreRequested,
      { benchmarkId: IDS.suite, expectedAggregateVersion: 3 },
    ],
  ])('accepts %s', (eventType, data) => {
    const message = {
      ...envelope(eventType, data),
      aggregateType: 'benchmark',
      aggregateId: IDS.suite,
    };
    expect(parseBenchmarkIntegrationMessageV1(message)).toBe(message);
  });

  it('accepts a rejected Benchmark suite command', () => {
    const message = {
      ...envelope(BENCHMARK_MESSAGE_TYPES.commandRejected, {
        commandEventId: IDS.causation,
        reasonCode: 'BENCHMARK_NAME_CONFLICT',
        message: 'Benchmark name already exists',
      }),
      aggregateType: 'benchmark',
      aggregateId: IDS.suite,
    };

    expect(parseBenchmarkIntegrationMessageV1(message)).toBe(message);
  });

  it('rejects a command produced by Benchmark service', () => {
    const message = envelope(BENCHMARK_MESSAGE_TYPES.testDeleteRequested, {
      testId: IDS.test,
      expectedAggregateVersion: 3,
    });
    message.producer = 'benchmark-service';

    expect(() => parseBenchmarkIntegrationMessageV1(message)).toThrow(
      /producer must be "benchmark-catalog"/
    );
  });

  it('rejects a service event produced by Catalog', () => {
    const message = envelope(BENCHMARK_MESSAGE_TYPES.testDeleted, {
      testId: IDS.test,
      deletedAt: '2026-09-07T12:00:00.000Z',
    });
    message.producer = 'benchmark-catalog';

    expect(() => parseBenchmarkIntegrationMessageV1(message)).toThrow(
      /producer must be "benchmark-service"/
    );
  });

  it('requires a rejection to identify the rejected command as its cause', () => {
    const message = envelope(BENCHMARK_MESSAGE_TYPES.commandRejected, {
      commandEventId: IDS.causation,
      reasonCode: 'TEST_NAME_CONFLICT',
      message: 'Test name already exists',
    });
    message.causationId = IDS.event;

    expect(() => parseBenchmarkIntegrationMessageV1(message)).toThrow(
      /causationId must equal/
    );
  });

  it.each([
    [
      BENCHMARK_MESSAGE_TYPES.suiteSnapshot,
      {
        benchmark: {
          id: IDS.suite,
          aggregateVersion: 3,
          name: 'Группа',
          nameEn: 'Suite',
          createdAt: '2026-09-07T10:00:00.000Z',
          updatedAt: '2026-09-07T12:00:00.000Z',
          deletedAt: null,
        },
      },
    ],
    [
      BENCHMARK_MESSAGE_TYPES.suiteDeleted,
      { benchmarkId: IDS.suite, deletedAt: '2026-09-07T12:00:00.000Z' },
    ],
  ])('accepts %s', (eventType, data) => {
    const message = {
      ...envelope(eventType, data),
      aggregateType: 'benchmark',
      aggregateId: IDS.suite,
    };

    expect(parseBenchmarkIntegrationMessageV1(message)).toBe(message);
  });

  it.each([
    [BENCHMARK_MESSAGE_TYPES.testCreateRequested, { testId: IDS.test, specification }],
    [
      BENCHMARK_MESSAGE_TYPES.testUpdateRequested,
      {
        testId: IDS.test,
        expectedAggregateVersion: 3,
        specification,
      },
    ],
    [
      BENCHMARK_MESSAGE_TYPES.testDeleteRequested,
      { testId: IDS.test, expectedAggregateVersion: 3 },
    ],
    [
      BENCHMARK_MESSAGE_TYPES.testRestoreRequested,
      { testId: IDS.test, expectedAggregateVersion: 3 },
    ],
    [
      BENCHMARK_MESSAGE_TYPES.testSpecificationLockRequested,
      {
        testId: IDS.test,
        sourceEventId: IDS.causation,
        reason: 'metric_result_created',
      },
    ],
    [
      BENCHMARK_MESSAGE_TYPES.testSnapshot,
      {
        test: {
          id: IDS.test,
          aggregateVersion: 3,
          specification,
          specificationLockedAt: null,
          specificationLockReason: null,
          createdAt: '2026-09-07T10:00:00.000Z',
          updatedAt: '2026-09-07T12:00:00.000Z',
          deletedAt: null,
        },
      },
    ],
    [
      BENCHMARK_MESSAGE_TYPES.testDeleted,
      { testId: IDS.test, deletedAt: '2026-09-07T12:00:00.000Z' },
    ],
    [
      BENCHMARK_MESSAGE_TYPES.commandRejected,
      {
        commandEventId: IDS.causation,
        reasonCode: 'TEST_NAME_CONFLICT',
        message: 'Test name already exists',
      },
    ],
  ])('accepts %s', (eventType, data) => {
    const message = envelope(eventType, data);

    expect(parseBenchmarkIntegrationMessageV1(message)).toBe(message);
  });

  it.each([
    [
      'unknown event type',
      (message: any) => {
        message.eventType = 'benchmark.test.created.v9';
      },
    ],
    [
      'unknown contract version',
      (message: any) => {
        message.eventVersion = 2;
      },
    ],
    [
      'unknown envelope field',
      (message: any) => {
        message.headers = {};
      },
    ],
    [
      'non-UUID event id',
      (message: any) => {
        message.eventId = 'event-1';
      },
    ],
    [
      'non-UTC timestamp',
      (message: any) => {
        message.occurredAt = '2026-09-07';
      },
    ],
    [
      'zero aggregate version',
      (message: any) => {
        message.aggregateVersion = 0;
      },
    ],
    [
      'mismatched aggregate id',
      (message: any) => {
        message.data.testId = IDS.suite;
      },
    ],
  ])('rejects an invalid envelope: %s', (_name, mutate) => {
    const message = envelope(BENCHMARK_MESSAGE_TYPES.testDeleteRequested, {
      testId: IDS.test,
      expectedAggregateVersion: 2,
    });
    mutate(message);

    expect(() => parseBenchmarkIntegrationMessageV1(message)).toThrow(
      'Invalid Benchmark integration contract v1'
    );
  });

  it.each([
    [
      'catalog status',
      (spec: any) => {
        spec.validationStatus = 'published';
      },
    ],
    [
      'catalog metadata',
      (spec: any) => {
        spec.catalogEntry = { id: IDS.event };
      },
    ],
    [
      'metric results',
      (spec: any) => {
        spec.scores = [];
      },
    ],
    [
      'legacy metric names',
      (spec: any) => {
        spec.metrics = ['accuracy'];
      },
    ],
    [
      'full dataset payload',
      (spec: any) => {
        spec.dataset = [{ secret: true }];
      },
    ],
  ])('keeps Catalog, MetricResult and full data out of Test specification: %s', (_name, mutate) => {
    const changed = clone(specification) as any;
    mutate(changed);
    const message = envelope(BENCHMARK_MESSAGE_TYPES.testCreateRequested, {
      testId: IDS.test,
      specification: changed,
    });

    expect(() => parseBenchmarkIntegrationMessageV1(message)).toThrow(
      /contains unsupported fields/
    );
  });

  it.each(['taskTypeId', 'domainIds', 'subdomainIds', 'scores'])(
    'forbids DatasetSubsample-owned %s',
    (field) => {
      const changed = clone(specification) as any;
      changed.datasetSubsamples[0][field] = [];
      const message = envelope(BENCHMARK_MESSAGE_TYPES.testCreateRequested, {
        testId: IDS.test,
        specification: changed,
      });

      expect(() => parseBenchmarkIntegrationMessageV1(message)).toThrow(
        /contains unsupported fields/
      );
    }
  );

  it('rejects duplicate DatasetSubsample identities', () => {
    const changed = clone(specification) as any;
    changed.datasetSubsamples.push(clone(changed.datasetSubsamples[0]));

    expect(() =>
      parseBenchmarkIntegrationMessageV1(
        envelope(BENCHMARK_MESSAGE_TYPES.testCreateRequested, {
          testId: IDS.test,
          specification: changed,
        })
      )
    ).toThrow(/must not contain duplicate ids/);
  });

  it.each([
    [
      'overlong Test name',
      (changed: any) => {
        changed.name = 'x'.repeat(501);
      },
    ],
    [
      'empty skill',
      (changed: any) => {
        changed.skills = [''];
      },
    ],
    [
      'duplicate ability tag',
      (changed: any) => {
        changed.abilityTags = ['reasoning', 'reasoning'];
      },
    ],
    [
      'unsupported link type',
      (changed: any) => {
        changed.links[0].type = 'ftp';
      },
    ],
    [
      'non-HTTP URL',
      (changed: any) => {
        changed.references[0].url = 'ftp://example.test/paper';
      },
    ],
  ])('rejects specification contract drift: %s', (_name, mutate) => {
    const changed = clone(specification) as any;
    mutate(changed);

    expect(() =>
      parseBenchmarkIntegrationMessageV1(
        envelope(BENCHMARK_MESSAGE_TYPES.testCreateRequested, {
          testId: IDS.test,
          specification: changed,
        })
      )
    ).toThrow('Invalid Benchmark integration contract v1');
  });

  it('accepts ISO timestamps with an explicit non-UTC offset like the source contract', () => {
    const changed = clone(specification) as any;
    changed.generatedAt = '2026-09-07T12:00:00.000+03:00';
    const message = envelope(BENCHMARK_MESSAGE_TYPES.testCreateRequested, {
      testId: IDS.test,
      specification: changed,
    });
    message.occurredAt = '2026-09-07T12:00:00.000+03:00';

    expect(parseBenchmarkIntegrationMessageV1(message)).toBe(message);
  });

  it('rejects inconsistent length distributions', () => {
    const changed = clone(specification) as any;
    changed.requestLengthDist = { min: 10, median: 5, max: 20 };

    expect(() =>
      parseBenchmarkIntegrationMessageV1(
        envelope(BENCHMARK_MESSAGE_TYPES.testCreateRequested, {
          testId: IDS.test,
          specification: changed,
        })
      )
    ).toThrow(/min <= median <= max/);
  });

  it('preserves prompt-only examples with an empty reference output', () => {
    const changed = clone(specification) as any;
    changed.examples = [{ input: 'question', output: '' }];

    const message = envelope(BENCHMARK_MESSAGE_TYPES.testCreateRequested, {
      testId: IDS.test,
      specification: changed,
    });
    expect(parseBenchmarkIntegrationMessageV1(message)).toBe(message);
  });

  it('rejects a snapshot whose version differs from the envelope', () => {
    const message = envelope(BENCHMARK_MESSAGE_TYPES.testSnapshot, {
      test: {
        id: IDS.test,
        aggregateVersion: 2,
        specification,
        specificationLockedAt: null,
        specificationLockReason: null,
        createdAt: '2026-09-07T10:00:00.000Z',
        updatedAt: '2026-09-07T12:00:00.000Z',
        deletedAt: null,
      },
    });

    expect(() => parseBenchmarkIntegrationMessageV1(message)).toThrow(
      /must match envelope aggregateVersion/
    );
  });

  it('rejects an event whose type does not match its aggregate type', () => {
    const message = {
      ...envelope(BENCHMARK_MESSAGE_TYPES.suiteDeleted, {
        benchmarkId: IDS.test,
        deletedAt: '2026-09-07T12:00:00.000Z',
      }),
      aggregateType: 'test',
    };

    expect(() => parseBenchmarkIntegrationMessageV1(message)).toThrow(/must be "benchmark"/);
  });
});
