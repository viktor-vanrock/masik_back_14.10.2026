import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PaginationDto } from '@/common/dtos/paginationDto.dto';
import { Role } from '@/common/enums/role.enum';
import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';
import { hashValue } from '@/common/utils/hashValue';
import { User } from '@/generated/prisma/client';
import { CreateUserDto } from './dto/createUserDto.dto';
import { UpdateUserDto } from './dto/updateUserDto.dto';
import { IUsersRepository } from './repositories/users.repository.interface';

export type PublicUser = Omit<User, 'password'>;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(IUsersRepository)
    private readonly usersRepository: IUsersRepository
  ) {}

  async createUser(userData: CreateUserDto): Promise<PublicUser> {
    this.logger.debug(
      `Trying to create user with username="${userData.username}"`
    );

    const existingUser =
      await this.usersRepository.findUserByUsername(userData.username);

    if (existingUser) {
      this.logger.warn(
        `User with username="${userData.username}" already exists`
      );

      throw new ConflictException(
        `User with username "${userData.username}" already exists`
      );
    }

    const passwordHash = await hashValue(userData.password);

    const user = await this.usersRepository.createNewUser({
      ...userData,
      password: passwordHash,
      role: userData.role ?? Role.User,
    });

    this.logger.log(
      `User created successfully: id="${user.id}", username="${user.username}"`
    );

    return this.excludePassword(user);
  }

  async findAllUsers(
    queryParams: PaginationDto
  ): Promise<InfiniteDataResponseType<PublicUser>> {
    this.logger.debug('Fetching all users');

    const result =
      await this.usersRepository.findAllUsers(queryParams);

    return {
      data: result.data.map((user) => this.excludePassword(user)),
      total: result.total,
    };
  }

  async findUserById(id: string): Promise<PublicUser> {
    this.logger.debug(`Finding user by id="${id}"`);

    const user = await this.usersRepository.findUserById(id);

    if (!user) {
      this.logger.warn(`User with id="${id}" was not found`);

      throw new NotFoundException(`User with id "${id}" was not found`);
    }

    return this.excludePassword(user);
  }

  async findUserByUsername(
    username: string
  ): Promise<Nullable<User>> {
    this.logger.debug(`Finding user by username="${username}"`);

    return this.usersRepository.findUserByUsername(username);
  }

  async updateUserById(
    id: string,
    updateData: UpdateUserDto
  ): Promise<PublicUser> {
    this.logger.debug(`Trying to update user id="${id}"`);

    const currentUser = await this.usersRepository.findUserById(id);

    if (!currentUser) {
      this.logger.warn(`User with id="${id}" was not found`);

      throw new NotFoundException(`User with id "${id}" was not found`);
    }

    if (
      updateData.username &&
      updateData.username !== currentUser.username
    ) {
      const existingUser =
        await this.usersRepository.findUserByUsername(
          updateData.username
        );

      if (existingUser && existingUser.id !== id) {
        this.logger.warn(
          `Cannot update user id="${id}": username="${updateData.username}" is already taken`
        );

        throw new ConflictException(
          `User with username "${updateData.username}" already exists`
        );
      }
    }

    const preparedUpdateData: UpdateUserDto = {
      ...updateData,
    };

    if (updateData.password) {
      preparedUpdateData.password = await hashValue(updateData.password);
    }

    const updatedUser =
      await this.usersRepository.updateUserById(
        id,
        preparedUpdateData
      );

    this.logger.log(`User updated successfully: id="${id}"`);

    return this.excludePassword(updatedUser);
  }

  async deleteUserById(id: string): Promise<void> {
    this.logger.debug(`Trying to delete user id="${id}"`);

    const user = await this.usersRepository.findUserById(id);

    if (!user) {
      this.logger.warn(`User with id="${id}" was not found`);

      throw new NotFoundException(`User with id "${id}" was not found`);
    }

    await this.usersRepository.deleteUserById(id);

    this.logger.log(`User deleted successfully: id="${id}"`);
  }

  private excludePassword(user: User): PublicUser {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...publicUser } = user;
    return publicUser;
  }
}
