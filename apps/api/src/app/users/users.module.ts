import { Module } from '@nestjs/common';
import {
  AdminUserRoleController,
  MeController,
  UsersController,
} from './users.controller.js';
import { UsersService } from './users.service.js';
import { UserRoleService } from './user-role.service.js';
import { AccountModule } from '../account/account.module.js';
import { BirthDateController } from './birth-date.controller.js';
import { BirthDateService } from './birth-date.service.js';

@Module({
  // AccountModule: under-12 dates of birth delete the account at once.
  imports: [AccountModule],
  controllers: [
    UsersController,
    MeController,
    AdminUserRoleController,
    BirthDateController,
  ],
  providers: [UsersService, UserRoleService, BirthDateService],
  exports: [UsersService],
})
export class UsersModule {}
