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
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import { Public } from '@/common/decorators/public.decorator';
import { Roles } from '@/common/decorators/role.decorator';
import { Role } from '@/common/enums/role.enum';
import {
  ALL_DICTIONARY_TYPE_SLUGS,
  DICTIONARY_CATEGORY_SLUGS,
} from './dictionary.constants';
import { CreateDictionaryItemDto } from './dto/createDictionaryItem.dto';
import { CreateSubdomainDto } from './dto/createSubdomain.dto';
import { CreateSubGroupDto } from './dto/createSubGroup.dto';
import {
  DictionaryItemResponseDto,
  DictionaryListResponseDto,
} from './dto/dictionaryItemResponse.dto';
import { DictionaryListQueryDto } from './dto/dictionaryListQuery.dto';
import { SettingsAggregateResponseDto } from './dto/settingsAggregate.dto';
import { UpdateDictionaryItemDto } from './dto/updateDictionaryItem.dto';
import { UpdateSubdomainDto } from './dto/updateSubdomain.dto';
import { UpdateSubGroupDto } from './dto/updateSubGroup.dto';
import { SettingsAggregateService } from './settings-aggregate.service';
import { SettingsService } from './settings.service';

const ALLOWED_PAIRS_DESCRIPTION =
  'Allowed category/type pairs (any other combination returns 404):\n' +
  '- `taxonomy/macro-groups`, `taxonomy/sub-groups`, `taxonomy/ability-taxons`\n' +
  '- `parameters/task-types`, `parameters/modalities`, `parameters/languages`, `parameters/difficulties`, `parameters/capabilities`\n' +
  '- `domains/domains`, `domains/subdomains`';

@ApiTags('catalog/settings')
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
@ApiExtraModels(
  DictionaryItemResponseDto,
  DictionaryListResponseDto,
  SettingsAggregateResponseDto,
  CreateDictionaryItemDto,
  CreateSubGroupDto,
  CreateSubdomainDto,
  UpdateDictionaryItemDto,
  UpdateSubGroupDto,
  UpdateSubdomainDto
)
@Controller('catalog/settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly aggregateService: SettingsAggregateService
  ) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Get all active dictionaries (public aggregate)',
    description:
      'Returns active rows from all 10 taxonomy dictionaries, grouped into ' +
      'taxonomy/parameters/domains blocks. Public endpoint — no JWT required. ' +
      'Strict subset of fields: id, name, nameEn, description, descriptionEn, ' +
      'and parent FK (macroGroupId / domainId) where applicable. No internal ' +
      'timestamps, no usage counts.',
  })
  @ApiOkResponse({
    description: 'All active dictionary entries grouped by section',
    type: SettingsAggregateResponseDto,
  })
  async getAggregate() {
    return this.aggregateService.getAll();
  }

  @Get(':category/:type')
  @ApiCookieAuth(AUTH_COOKIE_NAME)
  @ApiOperation({
    summary: 'List dictionary entries (admin view)',
    description:
      'Paginated list with `usageCount`/`createdAt`/`updatedAt`. Soft-deleted ' +
      'rows are hidden. `parentId` is honored only for `taxonomy/sub-groups` ' +
      '(macroGroupId) and `domains/subdomains` (domainId).\n\n' +
      ALLOWED_PAIRS_DESCRIPTION,
  })
  @ApiParam({
    name: 'category',
    description: 'Dictionary category slug',
    enum: [...DICTIONARY_CATEGORY_SLUGS],
  })
  @ApiParam({
    name: 'type',
    description:
      'Dictionary type slug — must be valid for the chosen category (see operation description)',
    enum: [...ALL_DICTIONARY_TYPE_SLUGS],
  })
  @ApiOkResponse({
    description: 'Paginated dictionary list',
    type: DictionaryListResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Unknown category, unknown type, or wrong category/type pair',
  })
  async list(
    @Param('category') category: string,
    @Param('type') type: string,
    @Query() query: DictionaryListQueryDto
  ) {
    return this.settingsService.list(category, type, query);
  }

  @Get(':category/:type/:id')
  @ApiCookieAuth(AUTH_COOKIE_NAME)
  @ApiOperation({
    summary: 'Get dictionary entry by id (admin view)',
    description:
      'Returns one active dictionary row with inline `usageCount`. 404 if ' +
      'soft-deleted or missing.\n\n' +
      ALLOWED_PAIRS_DESCRIPTION,
  })
  @ApiParam({ name: 'category', enum: [...DICTIONARY_CATEGORY_SLUGS] })
  @ApiParam({ name: 'type', enum: [...ALL_DICTIONARY_TYPE_SLUGS] })
  @ApiOkResponse({
    description: 'Dictionary entry',
    type: DictionaryItemResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid UUID' })
  @ApiNotFoundResponse({
    description: 'Unknown category/type pair, or entry not found',
  })
  async getOne(
    @Param('category') category: string,
    @Param('type') type: string,
    @Param('id', new ParseUUIDPipe()) id: string
  ) {
    return this.settingsService.getOne(category, type, id);
  }

  @Roles(Role.Admin, Role.SuperUser)
  @ApiCookieAuth(AUTH_COOKIE_NAME)
  @Post(':category/:type')
  @ApiOperation({
    summary: 'Create dictionary entry',
    description:
      'Admin or SuperUser role required. Sub-groups must include ' +
      '`macroGroupId`; subdomains must include `domainId`; both must reference ' +
      'active parents. Returns 409 Conflict if name/nameEn duplicates an ' +
      'existing entry (case-insensitive).\n\n' +
      ALLOWED_PAIRS_DESCRIPTION,
  })
  @ApiParam({ name: 'category', enum: [...DICTIONARY_CATEGORY_SLUGS] })
  @ApiParam({ name: 'type', enum: [...ALL_DICTIONARY_TYPE_SLUGS] })
  @ApiBody({
    description:
      'Create payload. Use CreateSubGroupDto for taxonomy/sub-groups, ' +
      'CreateSubdomainDto for domains/subdomains, CreateDictionaryItemDto otherwise.',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(CreateDictionaryItemDto) },
        { $ref: getSchemaPath(CreateSubGroupDto) },
        { $ref: getSchemaPath(CreateSubdomainDto) },
      ],
    },
  })
  @ApiCreatedResponse({
    description: 'Dictionary entry created',
    type: DictionaryItemResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed or unknown parent' })
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiNotFoundResponse({ description: 'Unknown category/type pair' })
  @ApiConflictResponse({
    description: 'Duplicate name or nameEn (case-insensitive)',
  })
  async create(
    @Param('category') category: string,
    @Param('type') type: string,
    @Body() body: unknown
  ) {
    return this.settingsService.create(category, type, body);
  }

  @Roles(Role.Admin, Role.SuperUser)
  @ApiCookieAuth(AUTH_COOKIE_NAME)
  @Patch(':category/:type/:id')
  @ApiOperation({
    summary: 'Update dictionary entry',
    description:
      'Admin or SuperUser role required.\n\n' + ALLOWED_PAIRS_DESCRIPTION,
  })
  @ApiParam({ name: 'category', enum: [...DICTIONARY_CATEGORY_SLUGS] })
  @ApiParam({ name: 'type', enum: [...ALL_DICTIONARY_TYPE_SLUGS] })
  @ApiBody({
    description:
      'Update payload. Use UpdateSubGroupDto for taxonomy/sub-groups, ' +
      'UpdateSubdomainDto for domains/subdomains, UpdateDictionaryItemDto otherwise.',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(UpdateDictionaryItemDto) },
        { $ref: getSchemaPath(UpdateSubGroupDto) },
        { $ref: getSchemaPath(UpdateSubdomainDto) },
      ],
    },
  })
  @ApiOkResponse({
    description: 'Dictionary entry updated',
    type: DictionaryItemResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed, invalid UUID, or unknown parent',
  })
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiNotFoundResponse({
    description: 'Unknown category/type pair, or entry not found',
  })
  @ApiConflictResponse({
    description: 'Duplicate name or nameEn (case-insensitive)',
  })
  async update(
    @Param('category') category: string,
    @Param('type') type: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown
  ) {
    return this.settingsService.update(category, type, id, body);
  }

  @Roles(Role.Admin, Role.SuperUser)
  @ApiCookieAuth(AUTH_COOKIE_NAME)
  @Delete(':category/:type/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Soft delete dictionary entry',
    description:
      'Admin or SuperUser role required. Returns 409 Conflict (with current ' +
      '`usageCount`) if there are active references to this entry; remove or ' +
      'reassign the dependent rows first.\n\n' + ALLOWED_PAIRS_DESCRIPTION,
  })
  @ApiParam({ name: 'category', enum: [...DICTIONARY_CATEGORY_SLUGS] })
  @ApiParam({ name: 'type', enum: [...ALL_DICTIONARY_TYPE_SLUGS] })
  @ApiNoContentResponse({ description: 'Dictionary entry soft deleted' })
  @ApiBadRequestResponse({ description: 'Invalid UUID' })
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  @ApiNotFoundResponse({
    description: 'Unknown category/type pair, or entry not found',
  })
  @ApiConflictResponse({
    description:
      'Entry is in use by active benchmark tests or child dictionary rows',
  })
  async softDelete(
    @Param('category') category: string,
    @Param('type') type: string,
    @Param('id', new ParseUUIDPipe()) id: string
  ) {
    return this.settingsService.softDelete(category, type, id);
  }
}
