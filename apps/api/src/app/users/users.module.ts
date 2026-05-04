import { Module } from '@nestjs/common';
import { MeController, UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  controllers: [UsersController, MeController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
