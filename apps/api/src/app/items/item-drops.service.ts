import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { validateDropWindow } from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';

/** Fields (ContentTranslation, entity ITEM) holding a drop's push copy. */
export const DROP_COPY_FIELDS = {
  title: 'dropTitle',
  body: 'dropBody',
} as const;

export interface DropCopy {
  title: string;
  body: string;
}

export interface ScheduleDropInput {
  itemIds: string[];
  startsAt: string;
  endsAt: string | null;
  /** Push copy per locale (`pt-BR`, `en-US`); `{item}` is replaced by the item name. */
  copy: Record<string, DropCopy>;
}

export interface ScheduledDropView {
  itemIds: string[];
  startsAt: string;
  endsAt: string | null;
  /** Items whose earlier announcement was cleared so the new window is announced. */
  reannounce: string[];
}

/** Replace `{item}` in admin-written copy with the (localised) item name. */
export function renderDropCopy(copy: DropCopy, itemName: string): DropCopy {
  return {
    title: copy.title.replaceAll('{item}', itemName),
    body: copy.body.replaceAll('{item}', itemName),
  };
}

/**
 * "Schedule limited drop" wizard (docs/04 Shop → Items, docs/08 §Limited
 * drops): puts the picked items on one drop window and stores the ITEM_DROP
 * push copy per locale. The existing drop-announcement job sends the push
 * when the window opens; the copy lives in ContentTranslation rows
 * (`ITEM` / `dropTitle` + `dropBody`) — not translatable fields of the
 * workspace, just per-locale text with no schema change.
 */
@Injectable()
export class ItemDropsService {
  constructor(private readonly prisma: PrismaService) {}

  async schedule(
    input: ScheduleDropInput,
    now = new Date(),
  ): Promise<ScheduledDropView> {
    const errors = validateDropWindow({
      isLimitedDrop: true,
      dropStartsAt: input.startsAt,
      dropEndsAt: input.endsAt,
    });
    if (input.endsAt && new Date(input.endsAt).getTime() <= now.getTime())
      errors.push('the drop window has already ended');
    for (const [locale, c] of Object.entries(input.copy)) {
      if (!c.title?.trim()) errors.push(`copy.${locale}.title is required`);
      if (!c.body?.trim()) errors.push(`copy.${locale}.body is required`);
    }
    if (errors.length)
      throw new BadRequestException({
        code: 'INVALID_DROP',
        message: `Invalid drop: ${errors.join('; ')}`,
        errors,
      });
    const ids = [...new Set(input.itemIds)];
    const items = await this.prisma.item.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true },
    });
    if (items.length !== ids.length)
      throw new NotFoundException('One or more items were not found');

    const startsAt = new Date(input.startsAt);
    const endsAt = input.endsAt ? new Date(input.endsAt) : null;
    const future = startsAt.getTime() > now.getTime();
    await this.prisma.$transaction(async (tx) => {
      await tx.item.updateMany({
        where: { id: { in: ids } },
        data: {
          isLimitedDrop: true,
          isActive: true,
          dropStartsAt: startsAt,
          dropEndsAt: endsAt,
        },
      });
      for (const id of ids)
        for (const [locale, c] of Object.entries(input.copy))
          for (const [key, field] of Object.entries(DROP_COPY_FIELDS)) {
            const value = c[key as keyof DropCopy].trim();
            await tx.contentTranslation.upsert({
              where: {
                entityType_entityId_locale_field: {
                  entityType: 'ITEM',
                  entityId: id,
                  locale,
                  field,
                },
              },
              create: {
                entityType: 'ITEM',
                entityId: id,
                locale,
                field,
                value,
              },
              update: { value, outdated: false },
            });
          }
      // A drop is announced once per item (`item_drop:<id>`); a new future
      // window clears that marker so the re-drop gets its own push.
      if (future)
        await tx.idempotencyRecord.deleteMany({
          where: { key: { in: ids.map((id) => `item_drop:${id}`) } },
        });
    });
    return {
      itemIds: ids,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt?.toISOString() ?? null,
      reannounce: future ? ids : [],
    };
  }

  /** Stored drop copy for `itemIds`: itemId → locale → copy. */
  async copyFor(
    itemIds: string[],
  ): Promise<Map<string, Map<string, DropCopy>>> {
    const out = new Map<string, Map<string, DropCopy>>();
    if (itemIds.length === 0) return out;
    const rows = await this.prisma.contentTranslation.findMany({
      where: {
        entityType: 'ITEM',
        entityId: { in: itemIds },
        field: { in: Object.values(DROP_COPY_FIELDS) },
      },
    });
    for (const r of rows) {
      const byLocale = out.get(r.entityId) ?? new Map<string, DropCopy>();
      const cur = byLocale.get(r.locale) ?? { title: '', body: '' };
      if (r.field === DROP_COPY_FIELDS.title) cur.title = r.value;
      else cur.body = r.value;
      byLocale.set(r.locale, cur);
      out.set(r.entityId, byLocale);
    }
    // Only complete pairs are usable.
    for (const [id, byLocale] of out) {
      for (const [l, c] of byLocale)
        if (!c.title || !c.body) byLocale.delete(l);
      if (byLocale.size === 0) out.delete(id);
    }
    return out;
  }
}
