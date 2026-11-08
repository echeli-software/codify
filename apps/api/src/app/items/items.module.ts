import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { Day2PetPushService } from './day2-pet-push.service.js';
import { ItemDropsController } from './item-drops.controller.js';
import { ItemDropsService } from './item-drops.service.js';
import { ItemsController } from './items.controller.js';
import { ItemsService } from './items.service.js';
import { PetNamesService } from './pet-names.service.js';
import { StarterPetService } from './starter-pet.service.js';

@Module({
  imports: [NotificationsModule],
  controllers: [ItemsController, ItemDropsController],
  providers: [
    ItemsService,
    ItemDropsService,
    StarterPetService,
    PetNamesService,
    Day2PetPushService,
  ],
  exports: [ItemsService],
})
export class ItemsModule {}
