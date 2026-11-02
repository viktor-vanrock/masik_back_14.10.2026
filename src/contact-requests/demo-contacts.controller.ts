import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import { CurrentUser } from '@/common/decorators/currentUser.decorator';
import { ContactRequestsRateLimitGuard } from './contact-requests-rate-limit.guard';
import { ContactRequestsService } from './contact-requests.service';
import { CreateDemoContactDto } from './dto/create-demo-contact.dto';
import { contactIdempotencyKey } from './idempotency-key';
import type { RequestUser } from '@/common/types/request.type';

@ApiTags('contact-requests')
@ApiCookieAuth(AUTH_COOKIE_NAME)
@Controller('demo/contacts')
export class DemoContactsController {
  constructor(private readonly service: ContactRequestsService) {}

  @Post()
  @UseGuards(ContactRequestsRateLimitGuard)
  @ApiOperation({ summary: 'Save visitor contacts for an owned ready DEMO request or completed chat' })
  create(@Body() body: CreateDemoContactDto, @CurrentUser() user: RequestUser,
    @Headers('Idempotency-Key') key: string) {
    const { conversationId, ...contact } = body;
    return this.service.create({ ...contact, chatId: conversationId }, user.id, contactIdempotencyKey(key));
  }
}
