import { Provider } from '@nestjs/common';
import { UsersRepository } from './users.repository';
import { IUsersRepository } from './users.repository.interface';

export const usersRepositoryProvider: Provider = {
  provide: IUsersRepository,
  useClass: UsersRepository,
};
