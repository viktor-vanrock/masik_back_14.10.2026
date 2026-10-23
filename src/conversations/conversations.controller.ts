import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import { CurrentUser } from '@/common/decorators/currentUser.decorator';
import { PaginationDto } from '@/common/dtos/paginationDto.dto';
import { ConversationsService } from './conversations.service';
import { UpdateConversationDto } from './dto/updateConversation.dto';
import type { RequestUser } from '@/common/types/request.type';

@ApiCookieAuth(AUTH_COOKIE_NAME)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List conversations',
    description: 'Returns paginated conversations ordered by createdAt desc.',
  })
  @ApiOkResponse({ description: 'Paginated conversations response' })
  async findAll(
    @Query() queryParams: PaginationDto,
    @CurrentUser() user: RequestUser
  ) {
    const result = await this.service.findAll(queryParams, user);
    return { ...result, data: result.data.map(({ agentContext, ...conversation }) => {
      void agentContext;
      return conversation;
    }) };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get conversation by id',
    description: 'Returns one conversation with full ordered message history.',
  })
  async findById(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: RequestUser
  ) {
    const { agentContext, ...conversation } = await this.service.findByIdWithMessages(id, user);
    void agentContext;
    return conversation;
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update conversation title and archive status',
  })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: RequestUser,
    @Body() body: UpdateConversationDto
  ) {
    return this.service.updateConversation(id, user, body);
  }
}
