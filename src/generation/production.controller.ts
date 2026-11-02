import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/currentUser.decorator';
import { ProductionJobsService } from './production-jobs.service';
import type { RequestUser } from '@/common/types/request.type';

@Controller('conversations/:id/production')
export class ProductionController {
  constructor(private readonly jobs: ProductionJobsService) {}

  @Get()
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: RequestUser) {
    return this.jobs.getForOwner(id, user.id);
  }

  @Post()
  @HttpCode(200)
  start(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
    @Body() body: unknown
  ) {
    return this.jobs.startForOwner(id, user.id, body);
  }
}
