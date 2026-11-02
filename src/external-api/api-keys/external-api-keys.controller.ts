import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import { CurrentUser } from '@/common/decorators/currentUser.decorator';
import { Roles } from '@/common/decorators/role.decorator';
import { Role } from '@/common/enums/role.enum';
import { type RequestUser } from '@/common/types/request.type';
import { CreateExternalApiKeyDto } from './dto/createExternalApiKeyDto.dto';
import { ExternalApiKeyResponseDto, ExternalApiKeyPublicDto } from './dto/externalApiKeyResponseDto.dto';
import { EXTERNAL_API_KEY_SCOPES } from './external-api-key.constants';
import { ExternalApiKeysService } from './external-api-keys.service';

@ApiTags('external-api-keys')
@ApiCookieAuth(AUTH_COOKIE_NAME)
@Controller('external-api/api-keys')
export class ExternalApiKeysController {
  constructor(private readonly apiKeysService: ExternalApiKeysService) {}

  @Roles(Role.Admin, Role.SuperUser)
  @Post()
  @ApiOperation({
    summary: 'Create external API key',
    description:
      'Creates API key for external services. Raw key is returned only once.',
  })
  @ApiCreatedResponse({ type: ExternalApiKeyResponseDto })
  async createApiKey(
    @Body() body: CreateExternalApiKeyDto,
    @CurrentUser() user: RequestUser
  ): Promise<ExternalApiKeyResponseDto> {
    return this.apiKeysService.createApiKey(body, user.id);
  }

  @Roles(Role.Admin, Role.SuperUser)
  @Get()
  @ApiOperation({
    summary: 'Get external API keys',
    description:
      'Returns API key metadata without raw key and without hash.',
  })
  @ApiOkResponse({ type: [ExternalApiKeyPublicDto] })
  async findAllApiKeys(): Promise<ExternalApiKeyPublicDto[]> {
    return this.apiKeysService.findAllApiKeys();
  }

  @Roles(Role.Admin, Role.SuperUser)
  @Get('scopes')
  @ApiOperation({
    summary: 'Get available external API key scopes',
    description:
      'Returns the server-side allowlist of permissions that can be granted to an external API key.',
  })
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: { type: 'string' },
      example: EXTERNAL_API_KEY_SCOPES,
    },
  })
  getAvailableScopes(): string[] {
    return [...EXTERNAL_API_KEY_SCOPES];
  }

  @Roles(Role.Admin, Role.SuperUser)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke external API key',
    description:
      'Revokes API key. Revoked keys can no longer access external API.',
  })
  @ApiNoContentResponse()
  async revokeApiKey(
    @Param('id', new ParseUUIDPipe()) id: string
  ): Promise<void> {
    return this.apiKeysService.revokeApiKey(id);
  }
}
