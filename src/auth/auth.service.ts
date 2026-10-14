import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcrypt';
import { StringValue } from 'ms';
import { Role } from '@/common/enums/role.enum';
import { RequestUser } from '@/common/types/request.type';
import { CreateUserDto } from '@/users/dto/createUserDto.dto';
import { UsersService } from '@/users/users.service';
import { JwtPayload } from './types';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService
  ) {}

  async validateUser(
    username: string,
    password: string
  ): Promise<RequestUser> {
    this.logger.debug(`Validating user username="${username}"`);

    const user =
      await this.usersService.findUserByUsername(username);

    if (!user) {
      this.logger.warn(`User has not been found: username="${username}"`);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.password) {
      this.logger.error(
        `User does not have a password: username="${username}"`
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await compare(password, user.password);

    if (!isMatch) {
      this.logger.warn(
        `Incorrect password for username="${username}"`
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    this.logger.debug(
      `User validated successfully: id="${user.id}", username="${user.username}"`
    );

    return {
      id: user.id,
      username: user.username,
      role: user.role as Role,
    };
  }

  async register(dto: CreateUserDto): Promise<string> {
    this.logger.debug(
      `Registering new user username="${dto.username}"`
    );

    const newUser = await this.usersService.createUser(dto);

    return this.login({
      id: newUser.id,
      username: newUser.username,
      role: newUser.role as Role,
    });
  }

  async login(user: RequestUser): Promise<string> {
    this.logger.debug(
      `Generating access token for user id="${user.id}"`
    );

    const payload = this.generatePayload(user);

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('jwtAccessSecret'),
      expiresIn:
        this.configService.getOrThrow<StringValue>('jwtAccessExpire'),
    });

    this.logger.log(
      `Access token issued for user id="${user.id}"`
    );

    return accessToken;
  }

  private generatePayload(user: RequestUser): JwtPayload {
    return {
      sub: user.id,
      role: user.role,
      username: user.username,
    };
  }
}
