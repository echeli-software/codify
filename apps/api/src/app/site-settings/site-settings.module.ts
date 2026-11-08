import { Global, Module } from '@nestjs/common';
import { SiteSettingsController } from './site-settings.controller.js';
import { SiteSettingsService } from './site-settings.service.js';

/** Site settings (branding, enabled locales) — global so any module can read them. */
@Global()
@Module({
  controllers: [SiteSettingsController],
  providers: [SiteSettingsService],
  exports: [SiteSettingsService],
})
export class SiteSettingsModule {}
