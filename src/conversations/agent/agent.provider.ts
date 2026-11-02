import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentEnvType } from '@/configs/types';
import { AgentMockService } from '../mock/agent.mock.service';
import { IAgentService } from './agent.service.interface';
import { AgentWsService } from './agent.ws.service';

export const agentServiceProvider: Provider = {
  provide: IAgentService,
  inject: [ConfigService, AgentMockService, AgentWsService],
  useFactory: (
    configService: ConfigService,
    mock: AgentMockService,
    ws: AgentWsService
  ): IAgentService => {
    const logger = new Logger('AgentServiceProvider');
    const config = configService.getOrThrow<AgentEnvType>('agent');

    if ('ws' === config.mode) {
      logger.log('Agent backend: WebSocket (external service)');
      return ws;
    }

    logger.log('Agent backend: mock');
    return mock;
  },
};
