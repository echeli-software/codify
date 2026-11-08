import { Module } from '@nestjs/common';
import { PromoCodesService } from './promo-codes.service.js';
import {
  PromoCodesAdminController,
  PromoCodesController,
} from './promo-codes.controller.js';

/** Coin promo codes (docs/08 §12). GamificationService comes from the global GamificationModule. */
@Module({
  controllers: [PromoCodesAdminController, PromoCodesController],
  providers: [PromoCodesService],
})
export class PromoCodesModule {}
