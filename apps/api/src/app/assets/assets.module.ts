import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';
import { ASSET_STORAGE, createAssetStorage } from './asset-storage.js';

@Module({
  controllers: [AssetsController],
  providers: [
    AssetsService,
    {
      provide: ASSET_STORAGE,
      useFactory: () => createAssetStorage(process.env),
    },
  ],
  exports: [AssetsService],
})
export class AssetsModule {}
