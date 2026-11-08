import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PetNameResponse } from './items.dto.js';
import { ItemsService } from './items.service.js';
import { cleanPetName } from './starter-pet.service.js';

/** Naming owned pets (docs/08 §10 "every pet can be named"). */
@Injectable()
export class PetNamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly items: ItemsService,
  ) {}

  /**
   * Name (or, with a blank name, un-name) an owned PET item. 404
   * `pet.not_owned` when the user doesn't own the item, 400 `pet.not_a_pet`
   * when it is not a PET. The starter pet's name is also written to the
   * legacy `User.petName` so older clients keep showing it.
   */
  async rename(
    userId: string,
    itemId: string,
    name: string | null | undefined,
  ): Promise<PetNameResponse> {
    const owned = await this.prisma.userItem.findUnique({
      where: { userId_itemId: { userId, itemId } },
      select: {
        source: true,
        item: { select: { slot: true, deletedAt: true } },
      },
    });
    if (!owned || owned.item.deletedAt)
      throw new NotFoundException({
        code: 'pet.not_owned',
        message: 'You do not own this pet',
      });
    if (owned.item.slot !== 'PET')
      throw new BadRequestException({
        code: 'pet.not_a_pet',
        message: 'Only pets can be named',
      });
    const nickname = cleanPetName(name);
    await this.prisma.$transaction([
      this.prisma.userItem.update({
        where: { userId_itemId: { userId, itemId } },
        data: { nickname },
      }),
      ...(owned.source === 'ONBOARDING'
        ? [
            this.prisma.user.update({
              where: { id: userId },
              data: { petName: nickname },
            }),
          ]
        : []),
    ]);
    return { itemId, nickname, avatar: await this.items.getAvatar(userId) };
  }
}
