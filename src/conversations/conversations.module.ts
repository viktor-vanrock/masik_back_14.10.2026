import { Module } from '@nestjs/common';
import { AuthModule } from '@/auth/auth.module';
import { WsJwtAuthGuard } from '@/auth/jwt/ws-jwt-auth.guard';
import { InterviewerServiceTokenGuard } from '@/generation/interviewer-service-token.guard';
import { HypothesesModule } from '@/hypotheses/hypotheses.module';
import { RecommendationsModule } from '@/recommendations/recommendations.module';
import { agentServiceProvider } from './agent/agent.provider';
import { AgentWsService } from './agent/agent.ws.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsGateway } from './conversations.gateway';
import { ConversationsService } from './conversations.service';
import { InterviewerAgentContextController } from './interviewer-agent-context.controller';
import { AgentMockService } from './mock/agent.mock.service';
import { conversationsRepositoryProvider } from './repository/conversations.repository.provider';

@Module({
  imports: [AuthModule, RecommendationsModule, HypothesesModule],
  controllers: [ConversationsController, InterviewerAgentContextController],
  providers: [
    ConversationsService,
    ConversationsGateway,
    AgentMockService,
    AgentWsService,
    agentServiceProvider,
    conversationsRepositoryProvider,
    WsJwtAuthGuard,
    InterviewerServiceTokenGuard,
  ],
  exports: [ConversationsService],
})
export class ConversationsModule {}
