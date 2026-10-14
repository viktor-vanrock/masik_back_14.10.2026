import {
  Body,
  Controller,
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
  ApiCookieAuth,
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import {
  BenchmarkCommandReceiptDto,
  isBenchmarkCommandReceipt,
} from '@/benchmark-service/integration/benchmark-command-receipt.dto';
import { CurrentUser } from '@/common/decorators/currentUser.decorator';
import { Roles } from '@/common/decorators/role.decorator';
import { Role } from '@/common/enums/role.enum';
import { CatalogEntryService } from './catalog-entry.service';
import { CatalogSubmissionQueryDto } from './dto/catalog-submission-query.dto';
import { ModerateCatalogEntryDto } from './dto/moderate-catalog-entry.dto';
import { SubmitCatalogEntryDto } from './dto/submit-catalog-entry.dto';
import type { RequestUser } from '@/common/types/request.type';
import type { Response } from 'express';

@ApiTags('catalog-submissions')
@ApiCookieAuth(AUTH_COOKIE_NAME)
@Controller('catalog')
export class CatalogEntryController {
  constructor(private readonly catalogEntryService: CatalogEntryService) {}

  @Post('submissions')
  @ApiOperation({ summary: 'Submit a Test to the benchmark catalog' })
  @ApiCreatedResponse({ description: 'Catalog submission created in validation state' })
  @ApiAcceptedResponse({
    description: 'Test submission command queued in remote write mode',
    type: BenchmarkCommandReceiptDto,
  })
  async submit(
    @Body() body: SubmitCatalogEntryDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.catalogEntryService.submit(body, user.id);
    if (isBenchmarkCommandReceipt(result)) {
      response.status(HttpStatus.ACCEPTED);
    }
    return result;
  }

  @Get('submissions/mine')
  @ApiOperation({ summary: 'Get submissions authored by the current user' })
  @ApiOkResponse({ description: 'Paginated authored submissions' })
  async findMine(
    @Query() query: CatalogSubmissionQueryDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.catalogEntryService.findMine(query, user.id);
  }

  @Get('submissions/:testId')
  @ApiOperation({ summary: 'Get one submission authored by the current user' })
  @ApiOkResponse({ description: 'Authored catalog submission' })
  @ApiNotFoundResponse({ description: 'Submission not found or belongs to another user' })
  async findOwnById(
    @Param('testId', new ParseUUIDPipe()) testId: string,
    @CurrentUser() user: RequestUser
  ) {
    return this.catalogEntryService.findOwnById(testId, user.id);
  }

  @Post('submissions/:testId/restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restore a submission authored by the current user' })
  @ApiOkResponse({ description: 'Submission restored and returned to validation' })
  @ApiAcceptedResponse({
    description: 'Submission restore command queued in remote write mode',
    type: BenchmarkCommandReceiptDto,
  })
  @ApiNotFoundResponse({ description: 'Submission not found or belongs to another user' })
  async restoreOwn(
    @Param('testId', new ParseUUIDPipe()) testId: string,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.catalogEntryService.restoreOwn(testId, user.id);
    if (isBenchmarkCommandReceipt(result)) {
      response.status(HttpStatus.ACCEPTED);
    }
    return result;
  }

  @Roles(Role.Admin, Role.SuperUser)
  @Patch('entries/:testId/moderation')
  @ApiOperation({ summary: 'Publish or reject a catalog submission' })
  @ApiOkResponse({ description: 'Moderation decision recorded' })
  @ApiForbiddenResponse({ description: 'Admin or SuperUser role required' })
  @ApiNotFoundResponse({ description: 'Catalog entry not found' })
  async moderate(
    @Param('testId', new ParseUUIDPipe()) testId: string,
    @Body() body: ModerateCatalogEntryDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.catalogEntryService.moderate(testId, body, user.id);
  }
}
