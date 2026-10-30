import { Body, Controller, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import { CurrentUser } from '@/common/decorators/currentUser.decorator';
import { ContactRequestsService } from './contact-requests.service';
import { CreateContactRequestDto } from './dto/create-contact-request.dto';
import type { RequestUser } from '@/common/types/request.type';

@ApiTags('contact-requests')
@ApiCookieAuth(AUTH_COOKIE_NAME)
@Controller('contact-requests')
export class ContactRequestsController {
  constructor(private readonly service: ContactRequestsService) {}

  @Post()
  @ApiOperation({ summary: 'Save a visitor contact request for an owned chat' })
  @ApiCreatedResponse({ description: 'Returns a public request number' })
  create(@Body() body: CreateContactRequestDto, @CurrentUser() user: RequestUser) {
    return this.service.create(body, user.id);
  }
}
