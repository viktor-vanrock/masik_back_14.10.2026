import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import { CurrentUser } from '@/common/decorators/currentUser.decorator';
import { ContactRequestsRateLimitGuard } from './contact-requests-rate-limit.guard';
import { ContactRequestsService } from './contact-requests.service';
import { CreateContactRequestDto } from './dto/create-contact-request.dto';
import { contactIdempotencyKey } from './idempotency-key';
import type { RequestUser } from '@/common/types/request.type';

@ApiTags('contact-requests')
@ApiCookieAuth(AUTH_COOKIE_NAME)
@Controller('contact-requests')
export class ContactRequestsController {
  constructor(private readonly service: ContactRequestsService) {}

  @Post()
  @UseGuards(ContactRequestsRateLimitGuard)
  @ApiOperation({ summary: 'Save a visitor contact request for an owned chat' })
  @ApiCreatedResponse({
    description: 'Returns a public request number',
    schema: {
      type: 'object',
      required: ['publicNumber'],
      properties: { publicNumber: { type: 'string', example: 'AIJ-2026-8F4C21D9' } },
    },
  })
  create(@Body() body: CreateContactRequestDto, @CurrentUser() user: RequestUser,
    @Headers('Idempotency-Key') key: string) {
    return this.service.create(body, user.id, contactIdempotencyKey(key));
  }
}
