import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BENCHMARK_MESSAGE_TYPES, parseBenchmarkIntegrationMessageV1 } from '@/benchmark-service/contracts/benchmark-integration.v1';
import { CatalogBenchmarkProjectionService } from '@/catalog/projection/catalog-benchmark-projection.service';
import { Role } from '@/common/enums/role.enum';
import { KAFKA_TOPICS } from '@/kafka/kafka.constants';
import { MetricsTestReferenceService } from '@/metrics/repositories/metrics-test-reference.service';
import { PrismaService } from '@/prisma/prisma.service';
import { createAuthCookie, E2E_ORIGIN } from './support/auth';
import { createE2eApplication } from './support/create-e2e-application';

describe('Taxonomy usage from Benchmark projections (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string;
  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
    adminCookie = await createAuthCookie(app, Role.Admin);
  });

  beforeEach(async () => {
    await clearFixtures();
  });

  afterAll(async () => {
    await clearFixtures();
    await app.close();
  });

  async function clearFixtures(): Promise<void> {
    await prisma.benchmarkCommandOutcome.deleteMany();
    await prisma.outboxMessage.deleteMany({ where: { topic: KAFKA_TOPICS.benchmarkCommands } });
    await prisma.catalogTestProjection.deleteMany();
    await prisma.catalogBenchmarkProjection.deleteMany();
    await prisma.catalogEntry.deleteMany();
    await prisma.inboxMessage.deleteMany({ where: { topic: KAFKA_TOPICS.benchmarkEvents } });
    await prisma.metricDefinition.deleteMany({ where: { name: 'pending-reference-metric' } });
    await prisma.dictSubdomain.deleteMany();
    await prisma.dictDomain.deleteMany();
    await prisma.dictSubGroup.deleteMany();
    await prisma.dictMacroGroup.deleteMany();
    await prisma.dictAbilityTaxon.deleteMany();
    await prisma.dictTaskType.deleteMany();
    await prisma.dictModality.deleteMany();
    await prisma.dictLanguage.deleteMany();
    await prisma.dictDifficulty.deleteMany();
    await prisma.dictCapability.deleteMany();
  }

  it('counts a projected Test with a pending update only once', async () => {
    const domain = await prisma.dictDomain.create({
      data: { name: 'Pending Domain', nameEn: 'Pending Domain EN' },
    });
    const suiteId = randomUUID();
    await prisma.catalogBenchmarkProjection.create({
      data: {
        benchmarkId: suiteId,
        aggregateVersion: 1,
        name: 'Pending Suite',
        nameEn: 'Pending Suite EN',
        sourceCreatedAt: new Date(),
        sourceUpdatedAt: new Date(),
      },
    });
    const created = await request(app.getHttpServer())
      .post('/api/benchmark-tests')
      .set('Cookie', adminCookie)
      .set('Origin', E2E_ORIGIN)
      .send({
        suiteId, name: 'Pending Test', nameEn: 'Pending Test EN', description: 'Pending Test',
        domainIds: [domain.id.toUpperCase()], metrics: ['pending-reference-metric'],
      })
      .expect(202);
    const command = parseBenchmarkIntegrationMessageV1((await prisma.outboxMessage.findUniqueOrThrow({
      where: { id: created.body.operationId },
    })).payload);
    if (BENCHMARK_MESSAGE_TYPES.testCreateRequested !== command.eventType) {
      throw new Error('Expected Test create command');
    }
    const testId = created.body.aggregateId as string;
    const now = new Date().toISOString();
    await app.get(CatalogBenchmarkProjectionService).apply({
      eventId: randomUUID(), eventType: BENCHMARK_MESSAGE_TYPES.testSnapshot, eventVersion: 1,
      occurredAt: now, correlationId: randomUUID(), causationId: command.eventId,
      producer: 'benchmark-service', aggregateType: 'test', aggregateId: testId.toUpperCase(), aggregateVersion: 1,
      data: { test: {
        id: testId.toUpperCase(), aggregateVersion: 1, specification: command.data.specification,
        specificationLockedAt: null, specificationLockReason: null,
        createdAt: now, updatedAt: now, deletedAt: null,
      } },
    }, { topic: KAFKA_TOPICS.benchmarkEvents, partition: 0, offset: '0' });
    await expect(prisma.catalogTestProjection.findUnique({ where: { testId } })).resolves.toMatchObject({
      aggregateVersion: 1, deletedAt: null,
    });
    const updated = await request(app.getHttpServer())
      .patch(`/api/benchmark-tests/${testId.toUpperCase()}`)
      .set('Cookie', adminCookie)
      .set('Origin', E2E_ORIGIN)
      .send({ description: 'Pending update keeps references' });
    expect({ status: updated.status, error: updated.body.message }).toEqual({ status: 202, error: undefined });
    expect(updated.body.aggregateId).toBe(testId);
    await request(app.getHttpServer())
      .get(`/api/benchmark-tests/management/${testId}`)
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) => expect(body.domains).toContainEqual(expect.objectContaining({ id: domain.id })));
    await request(app.getHttpServer())
      .get('/api/catalog/settings/domains/domains')
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) => expect(body.data).toContainEqual(expect.objectContaining({ id: domain.id, usageCount: 1 })));
    await expect(app.get(MetricsTestReferenceService).findMetricUsageById(command.data.specification.metricIds[0]))
      .resolves.toEqual({ testAssignments: 1, results: 0 });
  });

  it.each(['projection', 'queued', 'processing'] as const)('protects every dictionary referenced by a %s Test', async (source) => {
    const macroGroup = await prisma.dictMacroGroup.create({
      data: { name: 'Remote Macro', nameEn: 'Remote Macro EN' },
    });
    const subGroup = await prisma.dictSubGroup.create({
      data: {
        macroGroupId: macroGroup.id,
        name: 'Remote Subgroup',
        nameEn: 'Remote Subgroup EN',
      },
    });
    const abilityTaxon = await prisma.dictAbilityTaxon.create({
      data: { name: 'Remote Ability', nameEn: 'Remote Ability EN' },
    });
    const taskType = await prisma.dictTaskType.create({
      data: { name: 'Remote Task', nameEn: 'Remote Task EN' },
    });
    const modality = await prisma.dictModality.create({
      data: { name: 'Remote Modality', nameEn: 'Remote Modality EN' },
    });
    const language = await prisma.dictLanguage.create({
      data: { name: 'Remote Language', nameEn: 'Remote Language EN' },
    });
    const difficulty = await prisma.dictDifficulty.create({
      data: { name: 'Remote Difficulty', nameEn: 'Remote Difficulty EN' },
    });
    const capability = await prisma.dictCapability.create({
      data: { name: 'Remote Capability', nameEn: 'Remote Capability EN' },
    });
    const domain = await prisma.dictDomain.create({
      data: { name: 'Remote Domain', nameEn: 'Remote Domain EN' },
    });
    const subdomain = await prisma.dictSubdomain.create({
      data: {
        domainId: domain.id,
        name: 'Remote Subdomain',
        nameEn: 'Remote Subdomain EN',
      },
    });
    const suiteId = randomUUID();
    const sourceDate = new Date('2026-09-13T10:00:00.000Z');
    await prisma.catalogBenchmarkProjection.create({
      data: {
        benchmarkId: suiteId,
        aggregateVersion: 1,
        name: 'Remote Suite',
        nameEn: 'Remote Suite EN',
        sourceCreatedAt: sourceDate,
        sourceUpdatedAt: sourceDate,
      },
    });
    const testId = randomUUID();
    const fields = {
      macroGroupId: macroGroup.id,
      taskTypeId: taskType.id,
      languageId: language.id,
      difficultyId: difficulty.id,
      subGroupIds: [subGroup.id],
      abilityTaxonIds: [abilityTaxon.id],
      modalityIds: [modality.id],
      capabilityIds: [capability.id],
      domainIds: [domain.id],
      subdomainIds: [subdomain.id],
    };
    let queued: { operationId: string; aggregateId: string } | undefined;
    if ('projection' === source) {
      await prisma.catalogTestProjection.create({ data: {
        testId,
        benchmarkId: suiteId,
        aggregateVersion: 1,
        snapshot: { source: 'benchmark-service' },
        name: 'Remote Test',
        nameEn: 'Remote Test EN',
        ...fields,
        sourceCreatedAt: sourceDate,
        sourceUpdatedAt: sourceDate,
      } });
    } else {
      const created = await request(app.getHttpServer())
        .post('/api/benchmark-tests')
        .set('Cookie', adminCookie)
        .set('Origin', E2E_ORIGIN)
        .send({ suiteId, name: 'Queued Test', nameEn: 'Queued Test EN', description: 'Pending Test', ...fields })
        .expect(202);
      queued = created.body;
      if ('processing' === source) {
        await prisma.outboxMessage.update({
          where: { id: queued!.operationId },
          data: { publishedAt: new Date() },
        });
      }
    }

    const protectedEntries = [
      ['taxonomy/macro-groups', macroGroup.id, 2],
      ['taxonomy/sub-groups', subGroup.id, 1],
      ['taxonomy/ability-taxons', abilityTaxon.id, 1],
      ['parameters/task-types', taskType.id, 1],
      ['parameters/modalities', modality.id, 1],
      ['parameters/languages', language.id, 1],
      ['parameters/difficulties', difficulty.id, 1],
      ['parameters/capabilities', capability.id, 1],
      ['domains/domains', domain.id, 2],
      ['domains/subdomains', subdomain.id, 1],
    ] as const;

    for (const [route, id, usageCount] of protectedEntries) {
      const listed = await request(app.getHttpServer())
        .get(`/api/catalog/settings/${route}`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(listed.body.data).toContainEqual(
        expect.objectContaining({ id, usageCount })
      );

      const deletion = await request(app.getHttpServer())
        .delete(`/api/catalog/settings/${route}/${id}`)
        .set('Origin', E2E_ORIGIN)
        .set('Cookie', adminCookie)
        .expect(409);
      expect(deletion.body).toMatchObject({ usageCount });
      await request(app.getHttpServer())
        .delete(`/api/catalog/settings/${route}/${id.toUpperCase()}`)
        .set('Origin', E2E_ORIGIN)
        .set('Cookie', adminCookie)
        .expect(409);
    }

    await prisma.catalogBenchmarkProjection.update({
      where: { benchmarkId: suiteId },
      data: { deletedAt: new Date('2026-09-13T11:00:00.000Z') },
    });
    if (queued) {
      await prisma.benchmarkCommandOutcome.create({
        data: {
          commandEventId: queued.operationId,
          responseEventId: randomUUID(),
          commandEventType: BENCHMARK_MESSAGE_TYPES.testCreateRequested,
          aggregateType: 'test',
          aggregateId: queued.aggregateId,
          status: 'rejected',
          reasonCode: 'BENCHMARK_NOT_FOUND',
          message: 'Benchmark is deleted',
          occurredAt: new Date(),
        },
      });
    }
    await expect(prisma.dictDifficulty.findUnique({ where: { id: difficulty.id } }))
      .resolves.toMatchObject({ deletedAt: null });
    const deletion = await request(app.getHttpServer())
      .delete(`/api/catalog/settings/parameters/difficulties/${difficulty.id}`)
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie);
    expect({ status: deletion.status, body: deletion.body }).toEqual({ status: 204, body: {} });
  });
});
