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
import { BenchmarkTestService } from './benchmark-test.service';
import { BenchmarkTestQueryDto } from './dto/benchmarkTestQuery.dto';
import { CreateBenchmarkTestDto } from './dto/createBenchmarkTest.dto';
import { UpdateBenchmarkTestDto } from './dto/updateBenchmarkTest.dto';
import type { Response } from 'express';

@ApiTags('benchmark-tests')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
@Controller('benchmark-tests')
export class BenchmarkTestController {
  constructor(private readonly benchmarkTestService: BenchmarkTestService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Get benchmark catalog (flat)',
    description:
      'Returns paginated BenchmarkTest cards mapped to frontend BenchmarkType. Supports search, id-based taxonomy filters, sorting and pagination. Optional `suiteIds[]` query param filters tests by parent Benchmark suite ids. Public — no JWT required.',
  })
  @ApiOkResponse({ description: 'Paginated catalog response' })
  async findAllBenchmark(@Query() query: BenchmarkTestQueryDto) {
    return await this.benchmarkTestService.findAllBenchmark(query);
  }

  @Public()
  @Get('filters/options')
  @ApiOperation({
    summary: 'Get catalog filter options',
    description:
      'Returns available filter values: FK-backed dimensions as { id, name, nameEn }[] (sub-groups carry macroGroupId, subdomains carry domainId); skills and abilityTags stay string[]. Public — no JWT required.',
  })
  @ApiOkResponse({ description: 'Filter options' })
  async getFilterOptions() {
    return await this.benchmarkTestService.getFilterOptions();
  }

  @Roles(Role.Admin, Role.SuperUser)
  @ApiCookieAuth(AUTH_COOKIE_NAME)
  @Get('management')
  @ApiOperation({
    summary: 'Get benchmark tests for management',
    description:
      'Returns all active BenchmarkTest records, including validation and rejected states. Requires Admin or SuperUser role.',
  })
  @ApiOkResponse({ description: 'Paginated management response' })
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  async findAllForManagement(@Query() query: BenchmarkTestQueryDto) {
    return await this.benchmarkTestService.findAllForManagement(query);
  }

  @Roles(Role.Admin, Role.SuperUser)
  @ApiCookieAuth(AUTH_COOKIE_NAME)
  @Get('management/:id')
  @ApiOperation({
    summary: 'Get benchmark test by id for management',
    description:
      'Returns an active BenchmarkTest in any moderation state. Requires Admin or SuperUser role.',
  })
  @ApiOkResponse({ description: 'BenchmarkTest management detail' })
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiNotFoundResponse({ description: 'BenchmarkTest not found' })
  async findForManagementById(
    @Param('id', new ParseUUIDPipe()) id: string
  ) {
    return await this.benchmarkTestService.findBenchmarkById(id);
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Get benchmark test by id',
    description:
      'Returns one BenchmarkTest mapped to frontend BenchmarkType, including taxonomy, links, instructions and metric scores. Public — no JWT required.',
  })
  @ApiOkResponse({ description: 'BenchmarkTest' })
  @ApiBadRequestResponse({ description: 'Invalid UUID' })
  @ApiNotFoundResponse({ description: 'BenchmarkTest not found' })
  async findBenchmarkById(@Param('id', new ParseUUIDPipe()) id: string) {
    return await this.benchmarkTestService.findPublishedBenchmarkById(id);
  }

  @Roles(Role.Admin, Role.SuperUser)
  @ApiCookieAuth(AUTH_COOKIE_NAME)
  @Post()
  @ApiOperation({
    summary: 'Create benchmark test',
    description:
      'Creates BenchmarkTest card with taxonomy, links, examples, dataset subsamples and metric definitions. `suiteId` (Benchmark uuid) is required — must reference an existing non-deleted Benchmark suite.',
  })
  @ApiCreatedResponse({ description: 'BenchmarkTest created' })
  @ApiAcceptedResponse({
    description: 'Test create command queued in remote write mode',
    type: BenchmarkCommandReceiptDto,
  })
  @ApiBadRequestResponse({
    description:
      'Validation failed, or Benchmark suite with given suiteId was not found',
  })
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  async createBenchmark(
    @Body() body: CreateBenchmarkTestDto,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.benchmarkTestService.createBenchmark(body);
    if (isBenchmarkCommandReceipt(result)) {
      response.status(HttpStatus.ACCEPTED);
    }
    return result;
  }

  @Roles(Role.Admin, Role.SuperUser)
  @ApiCookieAuth(AUTH_COOKIE_NAME)
  @Patch(':id')
  @ApiOperation({
    summary: 'Update benchmark test',
    description:
      'Updates BenchmarkTest and replaces array-like relations: skills, domains, metrics, examples, links and dataset subsamples. Send an existing DatasetSubsample `id` to preserve its identity; omitted ids create new subsamples and missing existing ids are removed. Optional `suiteId` can be sent to move the test to a different Benchmark suite (must exist and not be soft-deleted).',
  })
  @ApiOkResponse({ description: 'BenchmarkTest updated' })
  @ApiAcceptedResponse({
    description: 'Test update command queued in remote write mode',
    type: BenchmarkCommandReceiptDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid UUID, validation failed, or target Benchmark suite not found',
  })
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiNotFoundResponse({ description: 'BenchmarkTest not found' })
  async updateBenchmarkById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateBenchmarkTestDto,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.benchmarkTestService.updateBenchmarkById(
      id,
      body
    );
    if (isBenchmarkCommandReceipt(result)) {
      response.status(HttpStatus.ACCEPTED);
    }
    return result;
  }

  @Roles(Role.Admin, Role.SuperUser)
  @ApiCookieAuth(AUTH_COOKIE_NAME)
  @Post(':id/restore')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Restore soft-deleted benchmark test',
    description:
      'Restores a soft-deleted BenchmarkTest by clearing deletedAt. Requires Admin or SuperUser role. Idempotent: if the entity is already active, returns 200 with the current DTO.',
  })
  @ApiOkResponse({ description: 'BenchmarkTest restored' })
  @ApiAcceptedResponse({
    description: 'Test restore command queued in remote write mode',
    type: BenchmarkCommandReceiptDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid UUID' })
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiNotFoundResponse({ description: 'BenchmarkTest not found' })
  async restoreBenchmarkById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.benchmarkTestService.restoreBenchmarkById(id);
    if (isBenchmarkCommandReceipt(result)) {
      response.status(HttpStatus.ACCEPTED);
    }
    return result;
  }

  @Roles(Role.SuperUser)
  @ApiCookieAuth(AUTH_COOKIE_NAME)
  @HttpCode(204)
  @ApiOperation({
    summary: 'Soft delete benchmark test',
    description: 'Marks BenchmarkTest as deleted via deletedAt.',
  })
  @ApiNoContentResponse({ description: 'BenchmarkTest soft deleted' })
  @ApiAcceptedResponse({
    description: 'Test delete command queued in remote write mode',
    type: BenchmarkCommandReceiptDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid UUID' })
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiNotFoundResponse({ description: 'BenchmarkTest not found' })
  @ApiConflictResponse({ description: 'Active duplicate exists with the same name' })
  @Delete(':id')
  async softDeleteBenchmarkById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.benchmarkTestService.softDeleteBenchmarkById(id);
    if (isBenchmarkCommandReceipt(result)) {
      response.status(HttpStatus.ACCEPTED);
      return result;
    }
  }
}
