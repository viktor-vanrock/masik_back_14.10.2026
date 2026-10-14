import { Module } from '@nestjs/common';
import { AdminSeeder } from './admin.seeder';
import { usersRepositoryProvider } from './repositories/users-repository.provider';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    usersRepositoryProvider,
    AdminSeeder,
  ],
  exports: [UsersService],
})
export class UsersModule {}
