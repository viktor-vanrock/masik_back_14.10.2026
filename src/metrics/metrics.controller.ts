import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import { Public } from '@/common/decorators/public.decorator';
import { Roles } from '@/common/decorators/role.decorator';
import { PaginationDto } from '@/common/dtos/paginationDto.dto';
import { Role } from '@/common/enums/role.enum';
import { CreateMetricDefinitionDto } from './dto/create-metric-definition.dto';
import { CreateMetricResultDto } from './dto/create-metric-result.dto';
import { CreateModelDto } from './dto/create-model.dto';
import { UpdateMetricDefinitionDto } from './dto/update-metric-definition.dto';
import { MetricsService } from './metrics.service';

@ApiTags('metrics')
@ApiCookieAuth(AUTH_COOKIE_NAME)
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createMetric(@Body() body: CreateMetricDefinitionDto) {
    return await this.metricsService.createMetric(body);
  }

  @Get()
  async findAllMetrics(@Query() queryParams: PaginationDto) {
    return await this.metricsService.findAllMetrics(queryParams);
  }

  @Roles(Role.Admin, Role.SuperUser)
  @Patch(':id')
  async updateMetricById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateMetricDefinitionDto
  ) {
    return await this.metricsService.updateMetricById(id, body);
  }

  @Roles(Role.Admin, Role.SuperUser)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMetricById(@Param('id', new ParseUUIDPipe()) id: string) {
    return await this.metricsService.deleteMetricById(id);
  }

  @Get('lookups/priorities')
  @ApiOperation({ summary: 'Get metric priority lookups' })
  findAllPriorities() {
    return this.metricsService.findAllPriorities();
  }

  @Get('lookups/directions')
  @ApiOperation({ summary: 'Get metric direction lookups' })
  findAllDirections() {
    return this.metricsService.findAllDirections();
  }

  @Post('models')
  @ApiOperation({ summary: 'Create or update model used in benchmark results' })
  @ApiCreatedResponse({ description: 'Model created or updated' })
  createModel(@Body() body: CreateModelDto) {
    return this.metricsService.createModel(body);
  }

  @Public()
  @Get('models')
  @ApiOperation({ summary: 'Get all models' })
  @ApiOkResponse({ description: 'Models list' })
  findAllModels() {
    return this.metricsService.findAllModels();
  }

  @Post('results')
  @ApiOperation({ summary: 'Create metric result for model/Test' })
  @ApiCreatedResponse({ description: 'Metric result created' })
  createMetricResult(@Body() body: CreateMetricResultDto) {
    return this.metricsService.createMetricResult(body);
  }

  @Public()
  @Get('tests/:testId/results')
  @ApiOperation({ summary: 'Get metric results by benchmark test id' })
  findMetricResultsByTestId(
    @Param('testId') testId: string,
    @Query() queryParams: PaginationDto
  ) {
    return this.metricsService.findMetricResultsByTestId(
      testId,
      queryParams
    );
  }

  // Parameterized routes must be declared after static routes (for example
  // `/models`), otherwise Express treats the static segment as `:id`.
  @Get(':id')
  async findMetricById(@Param('id', new ParseUUIDPipe()) id: string) {
    return await this.metricsService.findMetricById(id);
  }
}
