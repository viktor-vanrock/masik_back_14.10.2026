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
import { ApiCookieAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AUTH_COOKIE_NAME } from '@/auth/cookie/authCookie';
import { CurrentUser } from '@/common/decorators/currentUser.decorator';
import { Roles } from '@/common/decorators/role.decorator';
import { PaginationDto } from '@/common/dtos/paginationDto.dto';
import { Role } from '@/common/enums/role.enum';
import { type RequestUser } from '@/common/types/request.type';
import { CreateUserDto } from './dto/createUserDto.dto';
import { UpdateUserDto } from './dto/updateUserDto.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiCookieAuth(AUTH_COOKIE_NAME)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles(Role.SuperUser)
  @Post()
  async createUser(@Body() body: CreateUserDto) {
    return await this.usersService.createUser(body);
  }

  @Get('profile')
  @ApiResponse({ status: 200 })
  async getProfile(@CurrentUser() user: RequestUser) {
    return await this.usersService.findUserById(user.id);
  }

  @Roles(Role.SuperUser)
  @Get()
  async findAllUsers(@Query() queryParams: PaginationDto) {
    return await this.usersService.findAllUsers(queryParams);
  }

  @Roles(Role.SuperUser)
  @Get(':id')
  async findUserById(
    @Param('id', new ParseUUIDPipe()) id: string
  ) {
    return await this.usersService.findUserById(id);
  }

  @Roles(Role.SuperUser)
  @Patch(':id')
  async updateUserById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateUserDto
  ) {
    return await this.usersService.updateUserById(id, body);
  }

  @Roles(Role.SuperUser)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUserById(
    @Param('id', new ParseUUIDPipe()) id: string
  ) {
    return await this.usersService.deleteUserById(id);
  }
}
