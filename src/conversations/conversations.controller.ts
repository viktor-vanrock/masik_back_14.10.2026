import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import { CurrentUser } from '@/common/decorators/currentUser.decorator';
import { PaginationDto } from '@/common/dtos/paginationDto.dto';
import { ConversationsService } from './conversations.service';
import { SidebarPaginationDto } from './dto/sidebarPagination.dto';
import { UpdateConversationDto } from './dto/updateConversation.dto';
import type { RequestUser } from '@/common/types/request.type';

@ApiCookieAuth(AUTH_COOKIE_NAME)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List conversations',
    description: 'Returns paginated conversations with pinned ones first by pinnedDate, then others by updatedAt desc.',
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

  @Get('sidebar')
  @ApiOperation({
    summary: 'List active pinned chats and one page of active history',
    description: 'Page 1 returns all active pins; later pages return only unpinned history. History uses a fixed page size of 20, sorted by updatedAt descending. The response includes total, pageSize and hasNextPage.',
  })
  @ApiOkResponse({
    description: 'Active sidebar conversations. Archived chats are available through /conversations/sidebar/archive.',
    schema: {
      type: 'object',
      required: ['pinned', 'data', 'total', 'pageSize', 'hasNextPage'],
      properties: {
        pinned: { type: 'array', items: { type: 'object' } },
        data: { type: 'array', items: { type: 'object' } },
        total: { type: 'integer', minimum: 0 },
        pageSize: { type: 'integer', example: 20 },
        hasNextPage: { type: 'boolean' },
      },
    },
  })
  async findSidebar(
    @Query() queryParams: SidebarPaginationDto,
    @CurrentUser() user: RequestUser
  ) {
    const result = await this.service.findSidebar(queryParams.page, user);
    const publicConversation = ({ agentContext, ...conversation }: (typeof result.data)[number]) => {
      void agentContext;
      return conversation;
    };
    return {
      pinned: result.pinned.map(publicConversation),
      data: result.data.map(publicConversation),
      total: result.total,
      pageSize: result.pageSize,
      hasNextPage: result.data.length > 0 && (queryParams.page - 1) * result.pageSize + result.data.length < result.total,
    };
  }

  @Get('sidebar/archive')
  @ApiOperation({ summary: 'List archived chats 20 at a time, sorted by updatedAt descending' })
  @ApiOkResponse({
    description: 'Archived conversations with total, pageSize and hasNextPage',
    schema: {
      type: 'object',
      required: ['data', 'total', 'pageSize', 'hasNextPage'],
      properties: {
        data: { type: 'array', items: { type: 'object' } },
        total: { type: 'integer', minimum: 0 },
        pageSize: { type: 'integer', example: 20 },
        hasNextPage: { type: 'boolean' },
      },
    },
  })
  async findArchived(
    @Query() queryParams: SidebarPaginationDto,
    @CurrentUser() user: RequestUser
  ) {
    const result = await this.service.findArchived(queryParams.page, user);
    return {
      data: result.data.map(({ agentContext, ...conversation }) => {
        void agentContext;
        return conversation;
      }),
      total: result.total,
      pageSize: result.pageSize,
      hasNextPage: result.data.length > 0 && (queryParams.page - 1) * result.pageSize + result.data.length < result.total,
    };
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
    summary: 'Update conversation title, archive or pin status',
  })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: RequestUser,
    @Body() body: UpdateConversationDto
  ) {
    return this.service.updateConversation(id, user, body);
  }
}
