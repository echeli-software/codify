import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ContentLocalizer } from './content-localizer.service.js';
import { TranslationFallbackInterceptor } from './translation-context.js';
import { TranslationsController } from './translations.controller.js';
import { TranslationsService } from './translations.service.js';

/**
 * Content-translation workspace + public resolver (docs/11 §3). Global so
 * read endpoints in other modules can inject `ContentLocalizer`; registers
 * the interceptor that emits `X-Translation-Fallback`.
 */
@Global()
@Module({
  controllers: [TranslationsController],
  providers: [
    TranslationsService,
    ContentLocalizer,
    { provide: APP_INTERCEPTOR, useClass: TranslationFallbackInterceptor },
  ],
  exports: [TranslationsService, ContentLocalizer],
})
export class TranslationsModule {}
