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
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import {
  BenchmarkCommandReceiptDto,
  isBenchmarkCommandReceipt,
} from '@/benchmark-service/integration/benchmark-command-receipt.dto';
import { Public } from '@/common/decorators/public.decorator';
import { Roles } from '@/common/decorators/role.decorator';
import { Role } from '@/common/enums/role.enum';
import { BenchmarkService } from './benchmark.service';
import { BenchmarkQueryDto } from './dto/benchmarkQuery.dto';
import {
  BenchmarkOptionDto,
  BenchmarkPaginatedResponseDto,
  BenchmarkResponseDto,
} from './dto/benchmarkResponse.dto';
import { CreateBenchmarkDto } from './dto/createBenchmark.dto';
import { UpdateBenchmarkDto } from './dto/updateBenchmark.dto';
import type { Response } from 'express';

@ApiTags('benchmarks')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
@ApiExtraModels(
  BenchmarkResponseDto,
  BenchmarkOptionDto,
  BenchmarkPaginatedResponseDto
)
@Controller('benchmarks')
export class BenchmarkController {
  constructor(private readonly benchmarkService: BenchmarkService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Get benchmark suites',
    description:
      'Returns paginated benchmark suites with number of active BenchmarkTest items. Supports search by name/nameEn (case-insensitive). Public — no JWT required.',
  })
  @ApiOkResponse({
    description: 'Paginated benchmark suites',
    type: BenchmarkPaginatedResponseDto,
  })
  async findAll(@Query() query: BenchmarkQueryDto) {
    return await this.benchmarkService.findAll(query);
  }

  @Public()
  @Get('options')
  @ApiOperation({
    summary: 'Get benchmark suite options',
    description:
      'Returns lightweight list { id, name, nameEn } for selects on BenchmarkTest create/edit form. Sorted by name asc. Public — no JWT required.',
  })
  @ApiOkResponse({
    description: 'Benchmark suite options',
    type: [BenchmarkOptionDto],
  })
  async findOptions() {
    return await this.benchmarkService.findOptions();
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Get benchmark suite by id',
    description:
      'Returns one benchmark suite with number of active BenchmarkTest items. Public — no JWT required.',
  })
  @ApiOkResponse({ description: 'Benchmark suite', type: BenchmarkResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid UUID' })
  @ApiNotFoundResponse({ description: 'Benchmark suite not found' })
  async findById(@Param('id', new ParseUUIDPipe()) id: string) {
    return await this.benchmarkService.findById(id);
  }

  @Roles(Role.Admin, Role.SuperUser)
  @ApiCookieAuth(AUTH_COOKIE_NAME)
  @Post()
  @ApiOperation({
    summary: 'Create benchmark suite',
    description:
      'Creates new benchmark suite (category). Requires Admin or SuperUser role.',
  })
  @ApiCreatedResponse({
    description: 'Benchmark suite created',
    type: BenchmarkResponseDto,
  })
  @ApiAcceptedResponse({
    description: 'Benchmark suite command queued in remote write mode',
    type: BenchmarkCommandReceiptDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  async create(
    @Body() body: CreateBenchmarkDto,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.benchmarkService.create(body);
    if (isBenchmarkCommandReceipt(result)) {
      response.status(HttpStatus.ACCEPTED);
    }
    return result;
  }

  @Roles(Role.Admin, Role.SuperUser)
  @ApiCookieAuth(AUTH_COOKIE_NAME)
  @Patch(':id')
  @ApiOperation({
    summary: 'Update benchmark suite',
    description:
      'Updates benchmark suite fields. Requires Admin or SuperUser role.',
  })
  @ApiOkResponse({
    description: 'Benchmark suite updated',
    type: BenchmarkResponseDto,
  })
  @ApiAcceptedResponse({
    description: 'Benchmark suite command queued in remote write mode',
    type: BenchmarkCommandReceiptDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid UUID or validation failed' })
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiNotFoundResponse({ description: 'Benchmark suite not found' })
  async updateById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateBenchmarkDto,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.benchmarkService.updateById(id, body);
    if (isBenchmarkCommandReceipt(result)) {
      response.status(HttpStatus.ACCEPTED);
    }
    return result;
  }

  @Roles(Role.Admin, Role.SuperUser)
  @ApiCookieAuth(AUTH_COOKIE_NAME)
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restore soft-deleted benchmark suite',
    description:
      'Restores a soft-deleted benchmark suite by clearing deletedAt. Requires Admin or SuperUser role. Idempotent: if the entity is already active, returns 200 with the current DTO.',
  })
  @ApiOkResponse({ description: 'Benchmark suite restored', type: BenchmarkResponseDto })
  @ApiAcceptedResponse({
    description: 'Benchmark suite restore command queued in remote write mode',
    type: BenchmarkCommandReceiptDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid UUID' })
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiNotFoundResponse({ description: 'Benchmark suite not found' })
  async restoreById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.benchmarkService.restoreById(id);
    if (isBenchmarkCommandReceipt(result)) {
      response.status(HttpStatus.ACCEPTED);
    }
    return result;
  }

  @Roles(Role.SuperUser)
  @ApiCookieAuth(AUTH_COOKIE_NAME)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Soft delete benchmark suite',
    description:
      'Marks benchmark suite as deleted via deletedAt. Requires SuperUser role. Fails with 409 if there are active BenchmarkTest items — reassign or delete them first.',
  })
  @ApiNoContentResponse({ description: 'Benchmark suite soft deleted' })
  @ApiAcceptedResponse({
    description: 'Benchmark suite delete command queued in remote write mode',
    type: BenchmarkCommandReceiptDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid UUID' })
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiNotFoundResponse({ description: 'Benchmark suite not found' })
  @ApiConflictResponse({
    description: 'Benchmark suite has active BenchmarkTest items',
  })
  async softDeleteById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.benchmarkService.softDeleteById(id);
    if (isBenchmarkCommandReceipt(result)) {
      response.status(HttpStatus.ACCEPTED);
      return result;
    }
  }
}
