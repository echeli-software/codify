import { Global, Module } from '@nestjs/common';
import { AppConfigService } from './app-config.service.js';

/**
 * Global config module. `AppConfigService` validates the environment on
 * construction (via `loadEnv()`), so a misconfigured deploy fails at boot.
 */
@Global()
@Module({
  providers: [
    { provide: AppConfigService, useFactory: () => new AppConfigService() },
  ],
  exports: [AppConfigService],
})
export class AppConfigModule {}
