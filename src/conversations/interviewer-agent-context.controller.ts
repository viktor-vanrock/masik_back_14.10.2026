import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { IsObject } from 'class-validator';
import { CsrfExempt } from '@/common/decorators/csrf-exempt.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { Prisma } from '@/generated/prisma/client';
import { InterviewerServiceTokenGuard } from '@/generation/interviewer-service-token.guard';
import { ConversationsService } from './conversations.service';

class UpdateAgentContextDto {
  @IsObject()
  context!: Prisma.InputJsonObject;
}

@Public()
@CsrfExempt()
@UseGuards(InterviewerServiceTokenGuard)
@Controller('internal/v1/interviewer/conversations')
export class InterviewerAgentContextController {
  constructor(private readonly service: ConversationsService) {}

  @Get(':conversationId/agent-context')
  getContext(@Param('conversationId', new ParseUUIDPipe({ version: '4' })) conversationId: string) {
    return this.service.getAgentContext(conversationId);
  }

  @Put(':conversationId/agent-context')
  updateContext(
    @Param('conversationId', new ParseUUIDPipe({ version: '4' })) conversationId: string,
    @Body() body: UpdateAgentContextDto
  ) {
    return this.service.updateAgentContext(conversationId, body.context);
  }
}
