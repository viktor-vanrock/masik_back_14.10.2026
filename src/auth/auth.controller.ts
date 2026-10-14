import {
  Body,
  Controller,
  HttpCode,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AUTH_COOKIE_NAME, getAuthCookieScopeOptions, getAuthCookieSetOptions } from '@/auth/cookie/authCookie';
import { CurrentUser } from '@/common/decorators/currentUser.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/registerDto.dto';
import { LocalAuthGuard } from './local/local-auth.guard';
import { AUTH_MOCK } from './mocks/auth.mock';
import type { RequestUser } from '@/common/types/request.type';
import type { Response } from 'express';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService
  ) {}

  @Public()
  @HttpCode(200)
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @ApiOperation({
    summary: 'Login. Sets an HttpOnly session cookie',
  })
  @ApiBody({
    schema: {
      example: AUTH_MOCK.loginBody,
    },
  })
  @ApiOkResponse({
    schema: {
      example: AUTH_MOCK.success,
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid credentials',
  })
  async login(
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response
  ) {
    const accessToken = await this.authService.login(user);
    res.cookie(AUTH_COOKIE_NAME, accessToken, getAuthCookieSetOptions(this.configService));
    return { success: true };
  }

  @Public()
  @HttpCode(201)
  @Post('register')
  @ApiOperation({
    summary: 'Register. Sets an HttpOnly session cookie',
  })
  @ApiBody({
    type: RegisterDto,
    examples: {
      default: {
        value: AUTH_MOCK.registerBody,
      },
    },
  })
  @ApiCreatedResponse({
    schema: {
      example: AUTH_MOCK.success,
    },
  })
  async register(
    @Body() body: RegisterDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const accessToken = await this.authService.register(body);
    res.cookie(AUTH_COOKIE_NAME, accessToken, getAuthCookieSetOptions(this.configService));
    return { success: true };
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  @ApiOperation({
    summary: 'Logout. Clears the session cookie',
    description:
      'Works even with an expired or missing cookie. Does not revoke an already-copied ' +
      'stateless JWT — it remains valid until its own expiry.',
  })
  @ApiOkResponse({
    schema: {
      example: AUTH_MOCK.success,
    },
  })
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(AUTH_COOKIE_NAME, getAuthCookieScopeOptions(this.configService));
    return { success: true };
  }
}
