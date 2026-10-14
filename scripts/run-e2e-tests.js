'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const composeFile = path.join(projectRoot, 'local', 'docker-compose.test.yml');
const composeProject = 'benchmark-catalog-e2e';
const npmCommand = 'win32' === process.platform ? 'npm.cmd' : 'npm';

const testDbPort = process.env.BENCHMARK_TEST_DB_PORT || '55432';
const managedDatabaseUrl =
  `postgresql://benchmark_catalog_test:benchmark_catalog_test@127.0.0.1:${testDbPort}` +
  '/benchmark_catalog_test?schema=public';
const suppliedDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = suppliedDatabaseUrl || managedDatabaseUrl;
const managesDocker = !suppliedDatabaseUrl;

function assertSafeTestDatabaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('TEST_DATABASE_URL must use the postgres or postgresql protocol.');
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!databaseName || !/test/i.test(databaseName)) {
    throw new Error(
      `Refusing to reset database "${databaseName || '<empty>'}": ` +
        'its name must contain "test".'
    );
  }
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (0 !== result.status) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${result.status}`);
  }
}

function dockerCompose(args, env) {
  run('docker', ['compose', '--project-name', composeProject, '-f', composeFile, ...args], env);
}

assertSafeTestDatabaseUrl(databaseUrl);

const testEnv = {
  ...process.env,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, '--experimental-vm-modules'].filter(Boolean).join(' '),
  NODE_ENV: 'test',
  DB_URL: databaseUrl,
  DATABASE_URL: databaseUrl,
  JWT_ACCESS_SECRET: 'e2e-only-access-secret',
  JWT_REFRESH_SECRET: 'e2e-only-refresh-secret',
  JWT_ACCESS_EXPIRE: '1h',
  JWT_REFRESH_EXPIRE: '1d',
  TRUSTED_ORIGINS: 'http://127.0.0.1',
  ORIGIN_TRUST_FORWARDED_HEADERS: 'false',
  ADMIN_SEED_ENABLED: 'false',
  KAFKA_ENABLED: 'false',
  AGENT_MODE: 'mock',
  EMBEDDING_PROVIDER: 'mock',
  EMBEDDING_MODEL: 'mock-hashed-bow-v1',
  EMBEDDING_SPEC_ID: 'mock-hashed-bow-v1:benchmark-test-document-v1:dim-1536:l2',
  EMBEDDING_DIMENSIONS: '1536',
  EMBEDDING_SOURCE_DIMENSIONS: '4096',
  RERANKER_PROVIDER: 'mock',
  RERANKER_MODEL: 'mock-lexical-reranker-v1',
};

let dockerStartupAttempted = false;
let exitCode = 0;

try {
  if (managesDocker) {
    dockerStartupAttempted = true;
    dockerCompose(['up', '-d', '--wait'], testEnv);
  }

  run(npmCommand, ['exec', 'prisma', '--', 'migrate', 'reset', '--force'], testEnv);

  const forwardedArgs = process.argv.slice(2).filter((argument) => '--runInBand' !== argument);

  run(
    npmCommand,
    ['exec', 'jest', '--', '--config', './test/jest-e2e.json', '--runInBand', ...forwardedArgs],
    testEnv
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  if (dockerStartupAttempted && 'true' !== process.env.KEEP_TEST_DATABASE?.trim().toLowerCase()) {
    try {
      dockerCompose(['down', '--volumes', '--remove-orphans'], testEnv);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      exitCode = 1;
    }
  }
}

process.exitCode = exitCode;
