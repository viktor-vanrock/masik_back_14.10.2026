import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Public } from '@/common/decorators/public.decorator';
import { Roles } from '@/common/decorators/role.decorator';
import { Role } from '@/common/enums/role.enum';
import { AnalyticsService } from './analytics.service';
import { AnalyticsDateRangeQueryDto } from './dto/analytics-date-range-query.dto';
import { AnalyticsEventsQueryDto } from './dto/analytics-events-query.dto';
import { AnalyticsTopQueryDto } from './dto/analytics-top-query.dto';
import { TrackBenchmarkViewDto } from './dto/track-benchmark-view.dto';
import { TrackCatalogEventDto } from './dto/track-catalog-event.dto';
import { AnalyticsTrackingContextType } from './types';
import type { RequestUser } from '@/common/types/request.type';
import type { Request as ExpressRequest } from 'express';

type MaybeAuthenticatedRequest = ExpressRequest & { user?: RequestUser };

@ApiTags('analytics')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
@ApiExtraModels(
  TrackBenchmarkViewDto,
  TrackCatalogEventDto,
  AnalyticsDateRangeQueryDto,
  AnalyticsTopQueryDto,
  AnalyticsEventsQueryDto
)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Public()
  @Post('benchmark-views')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Track benchmark view',
    description:
      'Public tracking endpoint for frontend. Stores one benchmark view event. If benchmarkTestId is passed, stores benchmark_test_view.',
  })
  @ApiCreatedResponse({ description: 'Analytics event was created' })
  async trackBenchmarkView(
    @Body() body: TrackBenchmarkViewDto,
    @Req() req: MaybeAuthenticatedRequest
  ) {
    return this.analyticsService.trackBenchmarkView(
      body,
      this.toTrackingContext(req, body.sessionId)
    );
  }

  @Public()
  @Post('catalog-events')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Track catalog search/filter event',
    description:
      'Public tracking endpoint for frontend. Use it to track catalog_search and filter_usage events for dashboard analytics.',
  })
  @ApiCreatedResponse({ description: 'Analytics event was created' })
  async trackCatalogEvent(
    @Body() body: TrackCatalogEventDto,
    @Req() req: MaybeAuthenticatedRequest
  ) {
    return this.analyticsService.trackCatalogEvent(
      body,
      this.toTrackingContext(req, body.sessionId)
    );
  }

  @Roles(Role.Admin, Role.SuperUser)
  @Get('overview')
  @ApiOperation({
    summary: 'Get analytics overview',
    description:
      'Admin dashboard summary: views, searches, filter usage, unique sessions, top benchmarks and daily series.',
  })
  @ApiOkResponse({ description: 'Analytics overview' })
  async getOverview(@Query() query: AnalyticsDateRangeQueryDto) {
    return this.analyticsService.getOverview(query);
  }

  @Roles(Role.Admin, Role.SuperUser)
  @Get('benchmarks/views')
  @ApiOperation({
    summary: 'Get top benchmarks by views',
    description:
      'Returns benchmarks sorted by total benchmark_view + benchmark_test_view events.',
  })
  @ApiOkResponse({ description: 'Top benchmarks by views' })
  async getTopBenchmarks(@Query() query: AnalyticsTopQueryDto) {
    return this.analyticsService.getTopBenchmarks(query);
  }

  @Roles(Role.Admin, Role.SuperUser)
  @Get('benchmark-tests/views')
  @ApiOperation({
    summary: 'Get top benchmark tests by views',
    description: 'Returns BenchmarkTest cards sorted by benchmark_test_view events.',
  })
  @ApiOkResponse({ description: 'Top benchmark tests by views' })
  async getTopBenchmarkTests(@Query() query: AnalyticsTopQueryDto) {
    return this.analyticsService.getTopBenchmarkTests(query);
  }

  @Roles(Role.Admin, Role.SuperUser)
  @Get('events')
  @ApiOperation({
    summary: 'Get analytics events',
    description:
      'Paginated raw event feed for admin debugging and detailed dashboard tables.',
  })
  @ApiOkResponse({ description: 'Paginated analytics events' })
  async getEvents(@Query() query: AnalyticsEventsQueryDto) {
    return this.analyticsService.getEvents(query);
  }

  private toTrackingContext(
    req: MaybeAuthenticatedRequest,
    sessionId?: string
  ): AnalyticsTrackingContextType {
    return {
      userId: req.user?.id,
      sessionId,
      ip: this.extractIp(req),
      userAgent: req.headers['user-agent'],
    };
  }

  private extractIp(req: MaybeAuthenticatedRequest): string | undefined {
    const forwardedFor = req.headers['x-forwarded-for'];

    if (Array.isArray(forwardedFor)) {
      return forwardedFor[0]?.split(',')[0]?.trim();
    }

    if ('string' === typeof forwardedFor && forwardedFor.length) {
      return forwardedFor.split(',')[0]?.trim();
    }

    return req.ip || req.socket.remoteAddress || undefined;
  }
}
