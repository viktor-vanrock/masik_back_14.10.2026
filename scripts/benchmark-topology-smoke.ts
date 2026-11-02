import 'dotenv/config';
import { randomUUID } from 'node:crypto';

type CommandReceipt = {
  operationId: string;
  aggregateId: string;
  aggregateType: 'benchmark' | 'test';
  status: 'queued';
};

type CommandStatus = {
  status: 'queued' | 'processing' | 'applied' | 'rejected';
  reasonCode?: string | null;
  message?: string | null;
};

const catalogUrl = process.env.CATALOG_SMOKE_URL ?? 'http://127.0.0.1:3000/api';
const benchmarkServiceUrl =
  process.env.BENCHMARK_SERVICE_SMOKE_URL ?? 'http://127.0.0.1:3100/api/v1';
const origin = process.env.CATALOG_SMOKE_ORIGIN ?? 'http://localhost:5173';
const timeoutMs = Number(process.env.CATALOG_SMOKE_TIMEOUT_MS ?? 20_000);

let cookie = '';
let suiteId: string | undefined;
let testId: string | undefined;

async function main(): Promise<void> {
  cookie = await login();
  const suffix = randomUUID();
  const suiteName = `Topology smoke ${suffix}`;

  const suite = await catalogMutation<CommandReceipt>('/benchmarks', 'POST', {
    name: suiteName,
    nameEn: suiteName,
    description: 'Temporary Catalog-Kafka-Benchmark Service smoke entity',
  }, 202);
  suiteId = suite.aggregateId;
  await waitForApplied(suite.operationId);

  let catalogSuite = await catalogGet<{ id: string; description: string | null }>(
    `/benchmarks/${suiteId}`
  );
  let serviceSuite = await serviceGet<{
    id: string;
    description: string | null;
  }>(`/benchmarks/${suiteId}`);
  assertId('Benchmark suite', suiteId, catalogSuite.id, serviceSuite.id);

  const duplicate = await catalogMutation<CommandReceipt>('/benchmarks', 'POST', {
    name: suiteName,
    nameEn: `${suiteName} duplicate`,
  }, 202);
  await waitForRejected(duplicate.operationId, 'BENCHMARK_NAME_CONFLICT');
  await expectCatalogStatus(`/benchmarks/${duplicate.aggregateId}`, 'GET', 404);
  await expectServiceStatus(`/benchmarks/${duplicate.aggregateId}`, 404);

  const suiteUpdate = await catalogMutation<CommandReceipt>(
    `/benchmarks/${suiteId}`,
    'PATCH',
    { description: 'Updated across the asynchronous boundary' },
    202
  );
  await waitForApplied(suiteUpdate.operationId);
  catalogSuite = await catalogGet(`/benchmarks/${suiteId}`);
  serviceSuite = await serviceGet(`/benchmarks/${suiteId}`);
  assertEqual(
    'Updated Benchmark description in Catalog',
    catalogSuite.description,
    'Updated across the asynchronous boundary'
  );
  assertEqual(
    'Updated Benchmark description in Benchmark Service',
    serviceSuite.description,
    'Updated across the asynchronous boundary'
  );

  const test = await catalogMutation<CommandReceipt>('/benchmark-tests', 'POST', {
    suiteId,
    name: `Topology Test ${suffix}`,
    nameEn: `Topology Test ${suffix}`,
    description: 'Temporary end-to-end Test',
    evaluationLogic: 'exact match',
    datasetSubsamples: [
      {
        name: 'validation',
        nameEn: 'validation',
        split: 'validation',
        examples: [{ input: 'question', output: 'answer' }],
      },
    ],
  }, 202);
  testId = test.aggregateId;
  await waitForApplied(test.operationId);

  let catalogTest = await catalogGet<{
    id: string;
    description: string;
    datasetSubsamples: unknown[];
  }>(`/benchmark-tests/management/${testId}`);
  let serviceTest = await serviceGet<{
    id: string;
    specification: { description: string; datasetSubsamples: unknown[] };
  }>(`/tests/${testId}`);
  assertId('Test', testId, catalogTest.id, serviceTest.id);
  if (
    catalogTest.datasetSubsamples.length !== 1 ||
    serviceTest.specification.datasetSubsamples.length !== 1
  ) {
    throw new Error('DatasetSubsample was not preserved across the Kafka boundary');
  }

  const testUpdate = await catalogMutation<CommandReceipt>(
    `/benchmark-tests/${testId}`,
    'PATCH',
    { description: 'Partial update preserved omitted Test fields' },
    202
  );
  await waitForApplied(testUpdate.operationId);
  catalogTest = await catalogGet(`/benchmark-tests/management/${testId}`);
  serviceTest = await serviceGet(`/tests/${testId}`);
  assertEqual(
    'Updated Test description in Catalog',
    catalogTest.description,
    'Partial update preserved omitted Test fields'
  );
  assertEqual(
    'Updated Test description in Benchmark Service',
    serviceTest.specification.description,
    'Partial update preserved omitted Test fields'
  );
  if (
    catalogTest.datasetSubsamples.length !== 1 ||
    serviceTest.specification.datasetSubsamples.length !== 1
  ) {
    throw new Error('Partial Test update discarded an omitted DatasetSubsample');
  }

  await expectCatalogStatus(`/benchmarks/${suiteId}`, 'DELETE', 409);

  await deleteTest();
  await expectCatalogStatus(`/benchmark-tests/management/${test.aggregateId}`, 'GET', 404);
  await expectServiceStatus(`/tests/${test.aggregateId}`, 404);

  await deleteSuite();
  await expectCatalogStatus(`/benchmarks/${suite.aggregateId}`, 'GET', 404);
  await expectServiceStatus(`/benchmarks/${suite.aggregateId}`, 404);

  testId = test.aggregateId;
  await expectCatalogStatus(`/benchmark-tests/${testId}/restore`, 'POST', 400);

  suiteId = suite.aggregateId;
  const suiteRestore = await catalogMutation<CommandReceipt>(
    `/benchmarks/${suiteId}/restore`,
    'POST',
    undefined,
    202
  );
  await waitForApplied(suiteRestore.operationId);

  const testRestore = await catalogMutation<CommandReceipt>(
    `/benchmark-tests/${testId}/restore`,
    'POST',
    undefined,
    202
  );
  await waitForApplied(testRestore.operationId);
  catalogTest = await catalogGet(`/benchmark-tests/management/${testId}`);
  serviceTest = await serviceGet(`/tests/${testId}`);
  assertId('Restored Test', testId, catalogTest.id, serviceTest.id);

  const idempotentRestore = await catalogMutation<CommandReceipt>(
    `/benchmark-tests/${testId}/restore`,
    'POST',
    undefined,
    202
  );
  await waitForApplied(idempotentRestore.operationId);

  await deleteTest();
  await deleteSuite();
  process.stdout.write(
    '[BenchmarkTopologySmoke] SUCCESS: create, rejection, update, delete, restore and projection convergence\n'
  );
}

async function login(): Promise<string> {
  const response = await fetch(`${catalogUrl}/auth/login`, {
    method: 'POST',
    headers: { ...jsonHeaders(), Origin: origin },
    body: JSON.stringify({
      username: process.env.ADMIN_LOGIN ?? 'admin',
      password: process.env.ADMIN_PASSWORD ?? 'admin1234!@$%',
    }),
  });
  await expectStatus(response, 200, 'Catalog login');
  const setCookie = response.headers.get('set-cookie');
  const sessionCookie = setCookie?.split(';', 1)[0];
  if (!sessionCookie) throw new Error('Catalog login did not return a session cookie');
  return sessionCookie;
}

async function deleteTest(): Promise<void> {
  if (!testId) return;
  const result = await catalogMutation<CommandReceipt>(
    `/benchmark-tests/${testId}`,
    'DELETE',
    undefined,
    202
  );
  await waitForApplied(result.operationId);
  testId = undefined;
}

async function deleteSuite(): Promise<void> {
  if (!suiteId) return;
  const result = await catalogMutation<CommandReceipt>(
    `/benchmarks/${suiteId}`,
    'DELETE',
    undefined,
    202
  );
  await waitForApplied(result.operationId);
  suiteId = undefined;
}

async function waitForApplied(operationId: string): Promise<void> {
  const current = await waitForTerminal(operationId);
  if (current.status === 'applied') return;
  throw new Error(
    `Benchmark command rejected (${current.reasonCode ?? 'unknown'}): ${current.message ?? 'no message'}`
  );
}

async function waitForRejected(
  operationId: string,
  expectedReasonCode: string
): Promise<void> {
  const current = await waitForTerminal(operationId);
  if (
    current.status === 'rejected' &&
    current.reasonCode === expectedReasonCode
  ) {
    return;
  }
  throw new Error(
    `Expected rejection ${expectedReasonCode}, received ${current.status} (${current.reasonCode ?? 'no reason code'})`
  );
}

async function waitForTerminal(operationId: string): Promise<CommandStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await catalogGet<CommandStatus>(
      `/benchmark-operations/${operationId}`
    );
    if (current.status === 'applied' || current.status === 'rejected') {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Benchmark command "${operationId}" did not complete in ${timeoutMs} ms`);
}

async function catalogGet<T>(path: string): Promise<T> {
  const response = await fetch(`${catalogUrl}${path}`, {
    headers: { Cookie: cookie },
  });
  return parse<T>(response, 200, `GET ${path}`);
}

async function serviceGet<T>(path: string): Promise<T> {
  const response = await fetch(`${benchmarkServiceUrl}${path}`);
  return parse<T>(response, 200, `Benchmark Service GET ${path}`);
}

async function expectCatalogStatus(
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  status: number
): Promise<void> {
  const response = await fetch(`${catalogUrl}${path}`, {
    method,
    headers: { ...jsonHeaders(), Cookie: cookie, Origin: origin },
  });
  await expectStatus(response, status, `${method} ${path}`);
}

async function expectServiceStatus(path: string, status: number): Promise<void> {
  const response = await fetch(`${benchmarkServiceUrl}${path}`);
  await expectStatus(response, status, `Benchmark Service GET ${path}`);
}

async function catalogMutation<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: object | undefined,
  status: number
): Promise<T> {
  const response = await fetch(`${catalogUrl}${path}`, {
    method,
    headers: { ...jsonHeaders(), Cookie: cookie, Origin: origin },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return parse<T>(response, status, `${method} ${path}`);
}

function jsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' };
}

async function parse<T>(
  response: Response,
  expectedStatus: number,
  operation: string
): Promise<T> {
  await expectStatus(response, expectedStatus, operation);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function expectStatus(
  response: Response,
  expectedStatus: number,
  operation: string
): Promise<void> {
  if (response.status === expectedStatus) return;
  const text = await response.text();
  throw new Error(
    `${operation} returned ${response.status}, expected ${expectedStatus}: ${text}`
  );
}

function assertId(
  entity: string,
  expected: string,
  catalogId: string,
  serviceId: string
): void {
  if (catalogId !== expected || serviceId !== expected) {
    throw new Error(
      `${entity} differs across services: expected=${expected}, catalog=${catalogId}, benchmarkService=${serviceId}`
    );
  }
}

function assertEqual(
  field: string,
  actual: string | null,
  expected: string
): void {
  if (actual !== expected) {
    throw new Error(`${field} differs: expected=${expected}, actual=${actual}`);
  }
}

void main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[BenchmarkTopologySmoke] ${message}\n`);
  await deleteTest().catch(() => undefined);
  await deleteSuite().catch(() => undefined);
  process.stderr.write(
    `[BenchmarkTopologySmoke] Left for inspection: suiteId=${suiteId ?? 'none'}, testId=${testId ?? 'none'}\n`
  );
  process.exitCode = 1;
});
