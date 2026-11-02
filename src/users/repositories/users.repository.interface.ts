import { PaginationDto } from '@/common/dtos/paginationDto.dto';
import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';
import { User } from '@/generated/prisma/client';
import { CreateUserDto } from '../dto/createUserDto.dto';
import { UpdateUserDto } from '../dto/updateUserDto.dto';

export abstract class IUsersRepository {
  abstract createNewUser(userData: CreateUserDto): Promise<User>;

  abstract findAllUsers(
    query: PaginationDto,
  ): Promise<InfiniteDataResponseType<User>>;

  abstract findUserById(id: string): Promise<Nullable<User>>;

  abstract updateUserById(
    id: string,
    updateData: UpdateUserDto,
  ): Promise<User>;

  abstract deleteUserById(id: string): Promise<void>;

  abstract findUserByUsername(username: string): Promise<Nullable<User>>;

  // TODO: Временно отключен refresh_token
  // abstract findUserByIdWithRefreshToken(id: string): Promise<User>;
}
