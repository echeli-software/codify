import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';
import { ASSET_STORAGE, createAssetStorage } from './asset-storage.js';
import {
  ASSET_SWEEP_POLICY,
  AssetSweepController,
  AssetSweepService,
  assetSweepPolicyFromEnv,
} from './asset-sweep.service.js';

@Module({
  controllers: [AssetsController, AssetSweepController],
  providers: [
    AssetsService,
    // Daily orphan sweep (docs/01 §6).
    AssetSweepService,
    {
      provide: ASSET_SWEEP_POLICY,
      useFactory: () => assetSweepPolicyFromEnv(process.env),
    },
    {
      provide: ASSET_STORAGE,
      useFactory: () => createAssetStorage(process.env),
    },
  ],
  exports: [AssetsService],
})
export class AssetsModule {}
