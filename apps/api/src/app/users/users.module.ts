import { Module } from '@nestjs/common';
import {
  AdminUserRoleController,
  MeController,
  UsersController,
} from './users.controller.js';
import { UsersService } from './users.service.js';
import { UserRoleService } from './user-role.service.js';

@Module({
  controllers: [UsersController, MeController, AdminUserRoleController],
  providers: [UsersService, UserRoleService],
  exports: [UsersService],
})
export class UsersModule {}
