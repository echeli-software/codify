import { Module } from '@nestjs/common';
import { ModulesController } from './modules.controller.js';
import { ModulesService } from './modules.service.js';

@Module({
  controllers: [ModulesController],
  providers: [ModulesService],
  exports: [ModulesService],
})
export class ModulesModule {}
