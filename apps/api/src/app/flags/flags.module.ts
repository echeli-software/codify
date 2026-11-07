import { Global, Module } from '@nestjs/common';
import { FeatureFlagService } from './feature-flag.service.js';
import { FeatureGuard } from './feature.guard.js';
import { AdminFlagsController, FlagsController } from './flags.controller.js';

/**
 * Feature flags + experiments (docs/10 §9, docs/04 Settings). Global so any
 * controller can use `@RequireFeature(key)` (FeatureGuard) or inject
 * FeatureFlagService without importing this module.
 */
@Global()
@Module({
  controllers: [FlagsController, AdminFlagsController],
  providers: [FeatureFlagService, FeatureGuard],
  exports: [FeatureFlagService, FeatureGuard],
})
export class FlagsModule {}
