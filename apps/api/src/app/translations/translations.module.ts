import { Module } from '@nestjs/common';
import { TranslationsController } from './translations.controller.js';
import { TranslationsService } from './translations.service.js';

/** Content-translation workspace + public resolver (docs/11 §3). */
@Module({
  controllers: [TranslationsController],
  providers: [TranslationsService],
  exports: [TranslationsService],
})
export class TranslationsModule {}
