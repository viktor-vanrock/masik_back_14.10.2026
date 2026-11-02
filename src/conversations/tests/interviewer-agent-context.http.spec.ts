import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import { JwtAuthGuard } from '@/auth/jwt/jwt-auth.guard';
import { JwtStrategy } from '@/auth/jwt/jwt.strategy';
import { Role } from '@/common/enums/role.enum';
import { OriginCsrfGuard } from '@/common/guards/origin-csrf.guard';
import { InterviewerServiceTokenGuard } from '@/generation/interviewer-service-token.guard';
import { HypothesesService } from '@/hypotheses/hypotheses.service';
import { RecommendationRequestsService } from '@/recommendations/recommendation-requests.service';
import { RecommendationsService } from '@/recommendations/recommendations.service';
import { IAgentService } from '../agent/agent.service.interface';
import { ConversationsController } from '../conversations.controller';
import { ConversationsService } from '../conversations.service';
import { InterviewerAgentContextController } from '../interviewer-agent-context.controller';
import { IConversationsRepository } from '../repository/conversations.repository.interface';

describe('Durable interviewer context HTTP contract', () => {
  let app: NestExpressApplication;
  const conversationId = '11111111-1111-4111-8111-111111111111';
  let conversation: Record<string, unknown>;
  let executionMode: 'execute' | 'prepare_only';
  const getAgentContext = jest.fn();
  const updateAgentContext = jest.fn();
  const findByIdWithMessages = jest.fn();
  const path = `/api/internal/v1/interviewer/conversations/${conversationId}/agent-context`;

  beforeAll(async () => {
    const values: Record<string, unknown> = {
      'agent.apiKey': 'factory-token', jwtAccessSecret: 'cookie-secret',
      nodeEnv: 'dev', trustedOrigins: [],
    };
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [ConversationsController, InterviewerAgentContextController],
      providers: [
        ConversationsService, JwtStrategy, InterviewerServiceTokenGuard,
        { provide: ConfigService, useValue: {
          get: (key: string) => values[key], getOrThrow: (key: string) => values[key],
        } },
        { provide: IConversationsRepository, useValue: {
          getAgentContext, updateAgentContext, findByIdWithMessages,
        } },
        { provide: IAgentService, useValue: {} },
        { provide: RecommendationRequestsService, useValue: {} },
        { provide: RecommendationsService, useValue: {} },
        { provide: HypothesesService, useValue: {} },
        { provide: APP_GUARD, useClass: OriginCsrfGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api');
    app.useBodyParser('json', { limit: '2mb' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => { await app?.close(); });
  beforeEach(() => {
    jest.clearAllMocks();
    conversation = { id: conversationId, userId: 'owner', agentContext: null, messages: [], recommendationRequests: [] };
    executionMode = 'execute';
    getAgentContext.mockImplementation(async () => ({ ...conversation, executionMode }));
    updateAgentContext.mockImplementation(async (_id: string, context: Record<string, unknown>) => {
      conversation = { ...conversation, agentContext: context };
      return conversation;
    });
    findByIdWithMessages.mockImplementation(async (id: string, userId: string) =>
      conversation.id === id && conversation.userId === userId ? conversation : null);
  });

  it('requires a service token for reading and writing', async () => {
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer()).put(path).send({ context: {} }).expect(401);
    await request(app.getHttpServer()).get(path).set('Authorization', 'Bearer wrong').expect(401);
    expect(getAgentContext).not.toHaveBeenCalled();
    expect(updateAgentContext).not.toHaveBeenCalled();
  });

  it('round-trips complete tool history and generation state', async () => {
    const context = { version: 1, requirements: { scope: 'mathematics' }, generation_job_id: 'job', messages: [
      { role: 'assistant', tool_calls: [{ id: 'search-1', type: 'function',
        function: { name: 'search_benchmarks', arguments: '{"query":"math"}' } }] },
      { role: 'tool', tool_call_id: 'search-1', content: '{"candidates":[]}' },
    ] };
    await request(app.getHttpServer()).get(path).set('Authorization', 'Bearer factory-token')
      .expect(200, { context: null, executionMode: 'execute' });
    await request(app.getHttpServer()).put(path).set('Authorization', 'Bearer factory-token')
      .send({ context }).expect(200, { context });
    await request(app.getHttpServer()).get(path).set('Authorization', 'Bearer factory-token')
      .expect(200, { context, executionMode: 'execute' });
    expect(updateAgentContext).toHaveBeenCalledWith(conversationId, context);
  });

  it('exposes only the saved public specification to the authenticated owner', async () => {
    const context = { requirements: { goal: ' Проверить знания ', scope: ' Налоги ' }, benchmark_name: ' Тест ',
      creation_requested: true, messages: [{ role: 'tool', content: 'internal' }], generation_job_id: 'internal-job' };
    await request(app.getHttpServer()).put(path).set('Authorization', 'Bearer factory-token')
      .send({ context }).expect(200);
    const detailPath = `/api/conversations/${conversationId}`;
    await request(app.getHttpServer()).get(detailPath).expect(401);
    const jwt = new JwtService({ secret: 'cookie-secret' });
    const cookie = `${AUTH_COOKIE_NAME}=${jwt.sign({ sub: 'owner', username: 'owner', role: Role.User })}`;
    const response = await request(app.getHttpServer()).get(detailPath).set('Cookie', cookie).expect(200);
    expect(response.body).toEqual({
      id: conversationId, userId: 'owner', messages: [], recommendationRequests: [], responseState: null,
      specification: { goal: 'Проверить знания', domain: 'Налоги', name: 'Тест', scenario: 'create' },
    });
    expect(findByIdWithMessages).toHaveBeenCalledWith(conversationId, 'owner');
    await request(app.getHttpServer()).get(path).set('Cookie', cookie).expect(401);
    await request(app.getHttpServer()).put(path).set('Cookie', cookie).send({ context: {} }).expect(401);
    expect(updateAgentContext).toHaveBeenCalledTimes(1);
  });

  it('returns the database execution mode separately from persisted context overrides', async () => {
    executionMode = 'prepare_only';
    const context = { executionMode: 'execute' };
    await request(app.getHttpServer()).put(path).set('Authorization', 'Bearer factory-token')
      .send({ context }).expect(200, { context });
    await request(app.getHttpServer()).get(path).set('Authorization', 'Bearer factory-token')
      .expect(200, { context, executionMode: 'prepare_only' });
  });

  it('projects ready metadata only for current DEMO, regardless of the stale JWT role', async () => {
    const requirements = { goal: 'Проверить знания', scope: 'Налоги', input_format: 'Текст', output_format: 'MCQA',
      language: 'Русский', difficulty: 'Средняя', evaluation: 'Exact Match', task_count: '10' };
    const context = { requirements, prepared_brief: { status: 'ready', revision: 'version-1', schema_version: '1.0',
      requirements, num_tasks: 10, brief: {
        schema_version: '1.0', decision: { type: 'compare_models' }, evaluation_target: { type: 'model' },
        task_context: { real_world_tasks: 'Налоги', required_scenarios: [{ id: 'scenario', text: 'Вычет' }] },
        quality_requirements: { critical_failures: [{ id: 'failure', text: 'Ошибка' }] },
        taxonomy: { macro_group_codes: ['knowledge'], knowledge_level: 'basic' },
        test: { input: { modalities: ['text'] }, output: { modalities: ['text'] }, languages: ['ru'],
          output_format: 'mcqa', interaction_mode: 'single_turn', difficulty: 'medium', evaluation: { methods: ['exact_match'] } },
      } } };
    await request(app.getHttpServer()).put(path).set('Authorization', 'Bearer factory-token').send({ context }).expect(200);
    const jwt = new JwtService({ secret: 'cookie-secret' });
    const get = (role: Role) => request(app.getHttpServer()).get(`/api/conversations/${conversationId}`)
      .set('Cookie', `${AUTH_COOKIE_NAME}=${jwt.sign({ sub: 'owner', username: 'owner', role })}`);
    executionMode = 'prepare_only';
    const ready = await get(Role.User).expect(200);
    expect(ready.body.demoRequest).toEqual({ status: 'ready', revision: 'version-1' });
    expect(ready.body).not.toHaveProperty('agentContext');
    expect(ready.body).not.toHaveProperty('prepared_brief');
    expect(ready.body).not.toHaveProperty('executionMode');
    executionMode = 'execute';
    expect((await get(Role.Demo).expect(200)).body).not.toHaveProperty('demoRequest');
    executionMode = 'prepare_only';
    conversation.agentContext = { ...context, requirements: { ...requirements, language: 'English' } };
    expect((await get(Role.Demo).expect(200)).body).not.toHaveProperty('demoRequest');
  });

  it.each([Role.User, Role.Demo, Role.Admin, Role.SuperUser])('keeps foreign specification reads hidden for %s', async (role) => {
    const jwt = new JwtService({ secret: 'cookie-secret' });
    const cookie = `${AUTH_COOKIE_NAME}=${jwt.sign({ sub: 'foreign', username: 'foreign', role })}`;
    await request(app.getHttpServer()).get(`/api/conversations/${conversationId}`).set('Cookie', cookie).expect(404);
    expect(findByIdWithMessages).toHaveBeenCalledWith(conversationId, 'foreign');
  });

  it.each([null, [], 'history', 1])('rejects a non-object context %j', async (context) => {
    await request(app.getHttpServer()).put(path).set('Authorization', 'Bearer factory-token')
      .send({ context }).expect(400);
    expect(updateAgentContext).not.toHaveBeenCalled();
  });

  it('rejects invalid UUIDs, missing conversations and oversized context', async () => {
    await request(app.getHttpServer()).get(path.replace(conversationId, 'invalid'))
      .set('Authorization', 'Bearer factory-token').expect(400);
    getAgentContext.mockResolvedValueOnce(null);
    await request(app.getHttpServer()).get(path).set('Authorization', 'Bearer factory-token').expect(404);
    await request(app.getHttpServer()).put(path).set('Authorization', 'Bearer factory-token')
      .send({ context: { data: 'x'.repeat(1024 * 1024) } }).expect(413);
    expect(updateAgentContext).not.toHaveBeenCalled();
  });
});
