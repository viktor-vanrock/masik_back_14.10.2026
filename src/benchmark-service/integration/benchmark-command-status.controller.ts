import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import { CurrentUser } from '@/common/decorators/currentUser.decorator';
import { Roles } from '@/common/decorators/role.decorator';
import { Role } from '@/common/enums/role.enum';
import { BenchmarkCommandStatusDto } from './benchmark-command-status.dto';
import { BenchmarkCommandStatusService } from './benchmark-command-status.service';
import type { RequestUser } from '@/common/types/request.type';

@ApiTags('benchmark-operations')
@ApiCookieAuth(AUTH_COOKIE_NAME)
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
@ApiForbiddenResponse({ description: 'Insufficient role' })
@Controller('benchmark-operations')
export class BenchmarkCommandStatusController {
  constructor(private readonly statuses: BenchmarkCommandStatusService) {}

  @Roles(Role.User, Role.Admin, Role.SuperUser)
  @Get(':commandEventId')
  @ApiOperation({ summary: 'Get asynchronous Benchmark command status' })
  @ApiOkResponse({ type: BenchmarkCommandStatusDto })
  @ApiNotFoundResponse({ description: 'Benchmark command not found' })
  get(
    @Param('commandEventId', new ParseUUIDPipe()) commandEventId: string,
    @CurrentUser() user: RequestUser
  ): Promise<BenchmarkCommandStatusDto> {
    return this.statuses.get(commandEventId, user);
  }
}
