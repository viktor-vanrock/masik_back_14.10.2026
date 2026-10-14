import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { PaginationDto } from '@/common/dtos/paginationDto.dto';
import { SortDirection } from '@/common/enums/sortDirection.enum';
import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';
import { Prisma, User } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateUserDto } from '../dto/createUserDto.dto';
import { UpdateUserDto } from '../dto/updateUserDto.dto';
import { IUsersRepository } from './users.repository.interface';

@Injectable()
export class UsersRepository implements IUsersRepository {
  private readonly logger = new Logger(UsersRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async createNewUser(userData: CreateUserDto): Promise<User> {
    this.logger.debug(
      `Creating new user with username="${userData.username}"`
    );

    const user = await this.prisma.user.create({
      data: {
        username: userData.username,
        password: userData.password,
        email: userData.email,
        role: userData.role,
      },
    });

    this.logger.log(
      `User created: id="${user.id}", username="${user.username}"`
    );

    return user;
  }

  async findAllUsers(
    queryParams: PaginationDto
  ): Promise<InfiniteDataResponseType<User>> {
    const {
      search,
      page,
      limit,
      sortColumn,
      sortDirection = SortDirection.Asc,
    } = queryParams;

    this.logger.debug(
      `Fetching users: page=${page}, limit=${limit}, search="${search ?? ''}", sortColumn="${sortColumn ?? ''}", sortDirection="${sortDirection}"`
    );

    const where: Prisma.UserWhereInput = {};

    if (search) {
      where.OR = [
        {
          username: {
            contains: search,
            mode: 'insensitive',
          },
        },
      ];
    }

    const allowedSortColumns = new Set([
      'createdAt',
      'username',
      'role',
    ]);

    const sort =
      sortColumn && allowedSortColumns.has(sortColumn)
        ? sortColumn
        : 'createdAt';

    const prismaSortDirection =
      sortDirection === SortDirection.Asc ? 'asc' : 'desc';

    const orderBy: Prisma.UserOrderByWithRelationInput = {
      [sort]: prismaSortDirection,
    };

    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.user.count({
        where,
      }),
    ]);

    this.logger.debug(
      `Fetched users: returned=${data.length}, total=${total}`
    );

    return {
      data,
      total,
    };
  }

  async findUserById(id: string): Promise<Nullable<User>> {
    this.logger.debug(`Finding user by id="${id}"`);

    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async updateUserById(
    id: string,
    updateData: UpdateUserDto
  ): Promise<User> {
    this.logger.debug(`Updating user id="${id}"`);

    const user = await this.prisma.user.update({
      where: { id },
      data: updateData,
    });

    this.logger.log(`User updated: id="${user.id}"`);

    return user;
  }

  async deleteUserById(id: string): Promise<void> {
    this.logger.debug(`Deleting user id="${id}"`);

    await this.prisma.user.delete({
      where: { id },
    });

    this.logger.log(`User deleted: id="${id}"`);
  }

  async findUserByUsername(
    username: string
  ): Promise<Nullable<User>> {
    this.logger.debug(`Finding user by username="${username}"`);

    return this.prisma.user.findUnique({
      where: { username },
    });
  }
}
