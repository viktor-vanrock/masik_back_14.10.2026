import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '@/auth/jwt/jwt-auth.guard';
import { JwtStrategy } from '@/auth/jwt/jwt.strategy';
import { OriginCsrfGuard } from '@/common/guards/origin-csrf.guard';
import { InterviewerServiceTokenGuard } from '@/generation/interviewer-service-token.guard';
import { HypothesesService } from '@/hypotheses/hypotheses.service';
import { RecommendationRequestsService } from '@/recommendations/recommendation-requests.service';
import { RecommendationsService } from '@/recommendations/recommendations.service';
import { IAgentService } from '../agent/agent.service.interface';
import { ConversationsService } from '../conversations.service';
import { InterviewerAgentContextController } from '../interviewer-agent-context.controller';
import { IConversationsRepository } from '../repository/conversations.repository.interface';

describe('Durable interviewer context HTTP contract', () => {
  let app: NestExpressApplication;
  const conversationId = '11111111-1111-4111-8111-111111111111';
  let conversation: Record<string, unknown>;
  const getAgentContext = jest.fn();
  const updateAgentContext = jest.fn();
  const path = `/api/internal/v1/interviewer/conversations/${conversationId}/agent-context`;

  beforeAll(async () => {
    const values: Record<string, unknown> = {
      'agent.apiKey': 'factory-token', jwtAccessSecret: 'cookie-secret',
      nodeEnv: 'dev', trustedOrigins: [],
    };
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [InterviewerAgentContextController],
      providers: [
        ConversationsService, JwtStrategy, InterviewerServiceTokenGuard,
        { provide: ConfigService, useValue: {
          get: (key: string) => values[key], getOrThrow: (key: string) => values[key],
        } },
        { provide: IConversationsRepository, useValue: {
          getAgentContext, updateAgentContext,
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
    conversation = { id: conversationId, agentContext: null };
    getAgentContext.mockImplementation(async () => conversation);
    updateAgentContext.mockImplementation(async (_id: string, context: Record<string, unknown>) => {
      conversation = { ...conversation, agentContext: context };
      return conversation;
    });
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
      .expect(200, { context: null });
    await request(app.getHttpServer()).put(path).set('Authorization', 'Bearer factory-token')
      .send({ context }).expect(200, { context });
    await request(app.getHttpServer()).get(path).set('Authorization', 'Bearer factory-token')
      .expect(200, { context });
    expect(updateAgentContext).toHaveBeenCalledWith(conversationId, context);
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
