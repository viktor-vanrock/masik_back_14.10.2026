import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@/common/enums/role.enum';
import { PrismaService } from '@/prisma/prisma.service';
import { createAuthCookie, E2E_ORIGIN } from './support/auth';
import { createE2eApplication } from './support/create-e2e-application';

describe('Benchmark taxonomy contract (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string;
  let userCookie: string;

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
    adminCookie = await createAuthCookie(app, Role.Admin);
    userCookie = await createAuthCookie(app, Role.User);
  });

  beforeEach(async () => {
    await clearFixtures();
  });

  afterAll(async () => {
    await clearFixtures();
    await app.close();
  });

  async function clearFixtures(): Promise<void> {
    await prisma.catalogTestProjection.deleteMany();
    await prisma.catalogBenchmarkProjection.deleteMany();
    await prisma.catalogEntry.deleteMany();
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

  it('returns a sorted public aggregate with only active fields and rows', async () => {
    const parent = await prisma.dictDomain.create({
      data: { name: 'Zoo', nameEn: 'Zoo EN', description: 'Visible domain' },
    });
    const alphabeticFirst = await prisma.dictDomain.create({
      data: { name: 'Alpha', nameEn: 'Alpha EN' },
    });
    const child = await prisma.dictSubdomain.create({
      data: {
        domainId: parent.id,
        name: 'Child',
        nameEn: 'Child EN',
      },
    });
    await prisma.dictDomain.create({
      data: {
        name: 'Deleted',
        nameEn: 'Deleted EN',
        deletedAt: new Date(),
      },
    });

    const response = await request(app.getHttpServer())
      .get('/api/catalog/settings')
      .expect(200);

    expect(response.body.domains.domains.map((item: { name: string }) => item.name)).toEqual([
      'Alpha',
      'Zoo',
    ]);
    expect(response.body.domains.domains[0]).toEqual({
      id: alphabeticFirst.id,
      name: 'Alpha',
      nameEn: 'Alpha EN',
      description: null,
      descriptionEn: null,
    });
    expect(response.body.domains.subdomains).toEqual([
      {
        id: child.id,
        domainId: parent.id,
        name: 'Child',
        nameEn: 'Child EN',
        description: null,
        descriptionEn: null,
      },
    ]);
    expect(response.body.domains.domains[0]).not.toHaveProperty('usageCount');
    expect(response.body.domains.domains[0]).not.toHaveProperty('createdAt');
  });

  it('enforces authentication, role, route-pair and payload validation', async () => {
    const payload = { name: 'Domain', nameEn: 'Domain EN' };

    await request(app.getHttpServer())
      .get('/api/catalog/settings/domains/domains')
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/catalog/settings/domains/domains')
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', userCookie)
      .send(payload)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/catalog/settings/domains/domains')
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({ name: 'Missing English name' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/catalog/settings/taxonomy/domains')
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send(payload)
      .expect(404);

    expect(await prisma.dictDomain.count()).toBe(0);
  });

  it('rejects dictionary duplicates case-insensitively', async () => {
    await request(app.getHttpServer())
      .post('/api/catalog/settings/domains/domains')
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({ name: 'Medicine', nameEn: 'Healthcare' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/catalog/settings/domains/domains')
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({ name: 'medicine', nameEn: 'Different English Name' })
      .expect(409);
    await request(app.getHttpServer())
      .post('/api/catalog/settings/domains/domains')
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({ name: 'Другое имя', nameEn: 'HEALTHCARE' })
      .expect(409);

    expect(await prisma.dictDomain.count()).toBe(1);
  });

  it('enforces case-insensitive uniqueness for every dictionary type', async () => {
    const rootRoutes = [
      ['taxonomy', 'macro-groups'],
      ['taxonomy', 'ability-taxons'],
      ['parameters', 'task-types'],
      ['parameters', 'modalities'],
      ['parameters', 'languages'],
      ['parameters', 'difficulties'],
      ['parameters', 'capabilities'],
      ['domains', 'domains'],
    ] as const;

    for (const [category, type] of rootRoutes) {
      const name = `Unique ${type}`;
      await request(app.getHttpServer())
        .post(`/api/catalog/settings/${category}/${type}`)
        .set('Origin', E2E_ORIGIN)
        .set('Cookie', adminCookie)
        .send({ name, nameEn: `${name} EN` })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/catalog/settings/${category}/${type}`)
        .set('Origin', E2E_ORIGIN)
        .set('Cookie', adminCookie)
        .send({ name: name.toLocaleLowerCase(), nameEn: `${name} other EN` })
        .expect(409);
    }

    const macroParents = await Promise.all([
      prisma.dictMacroGroup.create({
        data: { name: 'Child Parent A', nameEn: 'Child Parent A EN' },
      }),
      prisma.dictMacroGroup.create({
        data: { name: 'Child Parent B', nameEn: 'Child Parent B EN' },
      }),
    ]);
    const domainParents = await Promise.all([
      prisma.dictDomain.create({
        data: { name: 'Domain Parent A', nameEn: 'Domain Parent A EN' },
      }),
      prisma.dictDomain.create({
        data: { name: 'Domain Parent B', nameEn: 'Domain Parent B EN' },
      }),
    ]);
    const childCases = [
      {
        route: 'taxonomy/sub-groups',
        parentField: 'macroGroupId',
        parents: macroParents,
      },
      {
        route: 'domains/subdomains',
        parentField: 'domainId',
        parents: domainParents,
      },
    ] as const;

    for (const childCase of childCases) {
      const name = `Scoped ${childCase.route}`;
      await request(app.getHttpServer())
        .post(`/api/catalog/settings/${childCase.route}`)
        .set('Origin', E2E_ORIGIN)
        .set('Cookie', adminCookie)
        .send({
          [childCase.parentField]: childCase.parents[0].id,
          name,
          nameEn: `${name} EN`,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/catalog/settings/${childCase.route}`)
        .set('Origin', E2E_ORIGIN)
        .set('Cookie', adminCookie)
        .send({
          [childCase.parentField]: childCase.parents[0].id,
          name: name.toLocaleLowerCase(),
          nameEn: `${name} duplicate EN`,
        })
        .expect(409);

      // Child names are intentionally parent-scoped, not globally unique.
      await request(app.getHttpServer())
        .post(`/api/catalog/settings/${childCase.route}`)
        .set('Origin', E2E_ORIGIN)
        .set('Cookie', adminCookie)
        .send({
          [childCase.parentField]: childCase.parents[1].id,
          name: name.toLocaleLowerCase(),
          nameEn: `${name} EN`,
        })
        .expect(201);
    }
  });

  it('validates active parents and filters child dictionaries by parent', async () => {
    const firstParent = await prisma.dictDomain.create({
      data: { name: 'First Parent', nameEn: 'First Parent EN' },
    });
    const secondParent = await prisma.dictDomain.create({
      data: { name: 'Second Parent', nameEn: 'Second Parent EN' },
    });
    const deletedParent = await prisma.dictDomain.create({
      data: {
        name: 'Deleted Parent',
        nameEn: 'Deleted Parent EN',
        deletedAt: new Date(),
      },
    });

    const firstChild = await request(app.getHttpServer())
      .post('/api/catalog/settings/domains/subdomains')
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({
        domainId: firstParent.id,
        name: 'First Child',
        nameEn: 'First Child EN',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/catalog/settings/domains/subdomains')
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({
        domainId: secondParent.id,
        name: 'Second Child',
        nameEn: 'Second Child EN',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/catalog/settings/domains/subdomains')
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .send({
        domainId: deletedParent.id,
        name: 'Orphan Child',
        nameEn: 'Orphan Child EN',
      })
      .expect(400);

    const response = await request(app.getHttpServer())
      .get('/api/catalog/settings/domains/subdomains')
      .set('Cookie', userCookie)
      .query({ parentId: firstParent.id, search: 'child' })
      .expect(200);

    expect(response.body).toMatchObject({
      total: 1,
      data: [
        {
          id: firstChild.body.id,
          parentId: firstParent.id,
          name: 'First Child',
          usageCount: 0,
        },
      ],
    });
  });

  it('counts all active usages and refuses taxonomy deletion until references are gone', async () => {
    const domain = await prisma.dictDomain.create({
      data: { name: 'Used Domain', nameEn: 'Used Domain EN' },
    });
    const subdomain = await prisma.dictSubdomain.create({
      data: {
        domainId: domain.id,
        name: 'Used Child',
        nameEn: 'Used Child EN',
      },
    });
    const suiteId = randomUUID();
    const testId = randomUUID();
    const sourceDate = new Date('2026-09-14T00:00:00.000Z');
    await prisma.catalogBenchmarkProjection.create({
      data: {
        benchmarkId: suiteId,
        aggregateVersion: 1,
        name: 'Usage Suite',
        nameEn: 'Usage Suite EN',
        sourceCreatedAt: sourceDate,
        sourceUpdatedAt: sourceDate,
      },
    });
    await prisma.catalogTestProjection.create({
      data: {
        testId,
        benchmarkId: suiteId,
        aggregateVersion: 1,
        snapshot: { id: testId },
        name: 'Usage Test',
        nameEn: 'Usage Test EN',
        domainIds: [domain.id],
        sourceCreatedAt: sourceDate,
        sourceUpdatedAt: sourceDate,
      },
    });

    const list = await request(app.getHttpServer())
      .get('/api/catalog/settings/domains/domains')
      .set('Cookie', userCookie)
      .expect(200);
    expect(list.body.data[0]).toMatchObject({ id: domain.id, usageCount: 2 });

    const conflict = await request(app.getHttpServer())
      .delete(`/api/catalog/settings/domains/domains/${domain.id}`)
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .expect(409);
    expect(conflict.body).toMatchObject({ usageCount: 2 });

    await request(app.getHttpServer())
      .delete(`/api/catalog/settings/domains/subdomains/${subdomain.id}`)
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .expect(204);
    await prisma.catalogTestProjection.update({
      where: { testId },
      data: { deletedAt: new Date() },
    });
    await request(app.getHttpServer())
      .delete(`/api/catalog/settings/domains/domains/${domain.id}`)
      .set('Origin', E2E_ORIGIN)
      .set('Cookie', adminCookie)
      .expect(204);

    const aggregate = await request(app.getHttpServer())
      .get('/api/catalog/settings')
      .expect(200);
    expect(aggregate.body.domains).toEqual({ domains: [], subdomains: [] });
  });

  it('protects every dictionary relation used by an active Test', async () => {
    const macroGroup = await prisma.dictMacroGroup.create({
      data: { name: 'Matrix Macro', nameEn: 'Matrix Macro EN' },
    });
    const subGroup = await prisma.dictSubGroup.create({
      data: {
        macroGroupId: macroGroup.id,
        name: 'Matrix Subgroup',
        nameEn: 'Matrix Subgroup EN',
      },
    });
    const abilityTaxon = await prisma.dictAbilityTaxon.create({
      data: { name: 'Matrix Ability', nameEn: 'Matrix Ability EN' },
    });
    const taskType = await prisma.dictTaskType.create({
      data: { name: 'Matrix Task', nameEn: 'Matrix Task EN' },
    });
    const modality = await prisma.dictModality.create({
      data: { name: 'Matrix Modality', nameEn: 'Matrix Modality EN' },
    });
    const language = await prisma.dictLanguage.create({
      data: { name: 'Matrix Language', nameEn: 'Matrix Language EN' },
    });
    const difficulty = await prisma.dictDifficulty.create({
      data: { name: 'Matrix Difficulty', nameEn: 'Matrix Difficulty EN' },
    });
    const capability = await prisma.dictCapability.create({
      data: { name: 'Matrix Capability', nameEn: 'Matrix Capability EN' },
    });
    const domain = await prisma.dictDomain.create({
      data: { name: 'Matrix Domain', nameEn: 'Matrix Domain EN' },
    });
    const subdomain = await prisma.dictSubdomain.create({
      data: {
        domainId: domain.id,
        name: 'Matrix Subdomain',
        nameEn: 'Matrix Subdomain EN',
      },
    });
    const suiteId = randomUUID();
    const testId = randomUUID();
    const sourceDate = new Date('2026-09-14T00:00:00.000Z');
    await prisma.catalogBenchmarkProjection.create({
      data: {
        benchmarkId: suiteId,
        aggregateVersion: 1,
        name: 'Matrix Suite',
        nameEn: 'Matrix Suite EN',
        sourceCreatedAt: sourceDate,
        sourceUpdatedAt: sourceDate,
      },
    });
    await prisma.catalogTestProjection.create({
      data: {
        testId,
        benchmarkId: suiteId,
        aggregateVersion: 1,
        snapshot: { id: testId },
        name: 'Matrix Test',
        nameEn: 'Matrix Test EN',
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
        sourceCreatedAt: sourceDate,
        sourceUpdatedAt: sourceDate,
      },
    });

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
      const response = await request(app.getHttpServer())
        .delete(`/api/catalog/settings/${route}/${id}`)
        .set('Origin', E2E_ORIGIN)
        .set('Cookie', adminCookie)
        .expect(409);
      expect(response.body).toMatchObject({ usageCount });
    }
  });
});
