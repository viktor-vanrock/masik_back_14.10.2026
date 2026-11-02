import { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { swaggerConfig } from '@/configs/swagger.config';
import { createE2eApplication } from './support/create-e2e-application';

describe('Application bootstrap (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2eApplication();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the liveness probe under the production API prefix', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/live').expect(200);

    expect(response.body).toEqual({
      status: 'up',
      timestamp: expect.any(String),
    });
  });

  it('connects to migrated PostgreSQL with pgvector', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/ready').expect(200);

    expect(response.body).toMatchObject({
      status: 'up',
      timestamp: expect.any(String),
      checks: {
        database: {
          status: 'up',
          latencyMs: expect.any(Number),
          details: {
            pgvectorVersion: expect.any(String),
            searchIndex: 'synchronized',
          },
        },
      },
    });
  });

  it('generates the OpenAPI document without circular DTO metadata', () => {
    const document = SwaggerModule.createDocument(app, swaggerConfig);

    expect(document.paths['/api/catalog/submissions']).toBeDefined();
    expect(document.components?.schemas?.SubmitCatalogEntryDto).toMatchObject({
      properties: {
        authorId: {
          type: 'string',
          format: 'uuid',
          readOnly: true,
        },
      },
    });
  });
});
