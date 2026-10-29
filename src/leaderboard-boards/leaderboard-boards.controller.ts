import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import { CurrentUser } from '@/common/decorators/currentUser.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { CreateLeaderboardBoardDto } from './dto/create-leaderboard-board.dto';
import { UpdateLeaderboardBoardDto } from './dto/update-leaderboard-board.dto';
import { LeaderboardBoardsService } from './leaderboard-boards.service';
import type { RequestUser } from '@/common/types/request.type';

@ApiTags('leaderboard-boards')
@ApiCookieAuth(AUTH_COOKIE_NAME)
@Controller('leaderboard-boards')
export class LeaderboardBoardsController {
  constructor(private readonly service: LeaderboardBoardsService) {}
  @Public()
  @Get('public') listPublic() { return this.service.listPublic(); }
  @Get('mine') list(@CurrentUser() user: RequestUser) { return this.service.list(user.id); }
  @Post() create(@CurrentUser() user: RequestUser, @Body() dto: CreateLeaderboardBoardDto) { return this.service.create(user.id, dto); }
  @Patch(':id') update(@CurrentUser() user: RequestUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateLeaderboardBoardDto) { return this.service.update(user.id, id, dto); }
  @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) remove(@CurrentUser() user: RequestUser, @Param('id', new ParseUUIDPipe()) id: string) { return this.service.remove(user.id, id); }
}
