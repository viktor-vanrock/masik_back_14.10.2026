const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const source = require('../gigametrics_catalogue_q2_green.json');
const { prepareTaxonomy, mapTest } = require('./seed-benchmark-catalog.ts');

const key = (value) => value.replace(/\s+/g, ' ').trim().toLowerCase();
const taxonomy = prepareTaxonomy(source);
const maps = Object.fromEntries(
  Object.entries(taxonomy).map(([type, rows]) => [
    type,
    new Map(
      rows.map((row) => [
        type === 'SubGroup' ? `${key(row.macroGroup)}\0${key(row.name)}` : key(row.name),
        randomUUID(),
      ])
    ),
  ])
);
const suiteId = randomUUID();

test('all 40 original Tests satisfy the current create DTO without invented scores or data', () => {
  assert.equal(source.Benchmark.length, 10);
  assert.equal(source.BenchmarkTest.length, 40);
  for (const original of source.BenchmarkTest) {
    const dto = mapTest(original, suiteId, maps);
    assert.ok(dto.description);
    assert.equal(dto.evaluationLogic, original.evaluationLogic);
    assert.deepEqual(dto.metrics, original.metrics);
    assert.equal(dto.examples.length, original.examples.length);
    assert.deepEqual(dto.datasetSubsamples, []);
    assert.equal(dto.humanBaseline, undefined);
    assert.equal(dto.sizeInSamples, undefined);
    assert.equal(dto.validationStatus, undefined);
    assert.equal(dto.slug, undefined);
    assert.equal(dto.generatedAt, undefined);
    assert.equal(dto.metricResults, undefined);
    assert.equal(dto.run, undefined);
  }
});

test('empty descriptions use existing short descriptions, not generated text', () => {
  const original = source.BenchmarkTest.find((row) => !row.description);
  assert.equal(mapTest(original, suiteId, maps).description, original.shortDescription);
});

test('GigaMetrics source names are mapped to Test-owned current fields', () => {
  const original = {
    ...source.BenchmarkTest[0],
    gigaMetricsAdapterName: 'adapter',
    gigaMetricsSetUrl: 'https://example.org/data',
    gigaMetricsLaunchCommand: 'evaluate',
  };
  const dto = mapTest(original, suiteId, maps);
  assert.equal(dto.gigaMetricAdapterName, 'adapter');
  assert.equal(dto.gigaMetricSetUrl, original.gigaMetricsSetUrl);
  assert.equal(dto.gigaMetricLaunchCommand, 'evaluate');
  assert.equal(dto.gigaMetricsAdapterName, undefined);
});

test('cross-parent subgroup labels and feature labels are retained in valid dictionaries', () => {
  for (const original of source.BenchmarkTest) {
    const dto = mapTest(original, suiteId, maps);
    assert.equal(dto.subGroupIds.length, original.subGroups.length);
    for (const name of original.subGroups) {
      assert.ok(
        taxonomy.SubGroup.some(
          (row) => key(row.name) === key(name) && key(row.macroGroup) === key(original.macroGroup)
        )
      );
    }
    for (const name of original.featureLabels)
      assert.ok(dto.capabilityIds.includes(maps.Capability.get(key(name))));
  }
  assert.equal(source.taxonomy.SubGroup.length, 18);
  assert.equal(source.taxonomy.Capability.length, 0);
});

test('empty example output and actual numeric zero are preserved', () => {
  const original = {
    ...source.BenchmarkTest[0],
    humanBaseline: 0,
    sizeInSamples: 0,
    examples: [{ input: 'Original question', output: '', explanation: '' }],
  };
  const dto = mapTest(original, suiteId, maps);
  assert.equal(dto.examples[0].output, '');
  assert.equal(dto.humanBaseline, 0);
  assert.equal(dto.sizeInSamples, 0);
});

test('unknown taxonomy references or missing metrics fail instead of being silently dropped', () => {
  assert.throws(
    () => mapTest({ ...source.BenchmarkTest[0], macroGroup: 'Unknown group' }, suiteId, maps),
    /Unknown/
  );
  assert.throws(
    () => mapTest({ ...source.BenchmarkTest[0], metrics: [] }, suiteId, maps),
    /no metrics/
  );
});

test('invalid source links fail preflight DTO validation', () => {
  assert.throws(
    () =>
      mapTest(
        { ...source.BenchmarkTest[0], references: [{ title: 'Invalid', url: 'not-a-url' }] },
        suiteId,
        maps
      ),
    /Invalid Test/
  );
});
