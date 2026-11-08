import { Module } from '@nestjs/common';
import { LessonsController } from './lessons.controller.js';
import { LessonsService } from './lessons.service.js';
import { EmbedMetadataService } from './embed-metadata.service.js';

@Module({
  controllers: [LessonsController],
  providers: [LessonsService, EmbedMetadataService],
  exports: [LessonsService],
})
export class LessonsModule {}
