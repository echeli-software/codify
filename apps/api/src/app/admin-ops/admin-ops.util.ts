import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';

export const DEFAULT_LOCALE = 'pt-BR';

/** Accept-Language "en-US,en;q=0.9" → "en-US" (same rule as courses). */
export function pickLocale(header: string | undefined): string {
  const first = header?.split(',')[0]?.split(';')[0]?.trim();
  return first || DEFAULT_LOCALE;
}

/**
 * Keyset cursor over `(createdAt DESC, id DESC)`: base64url of
 * `<iso>|<id>`. Opaque to clients.
 */
export interface KeysetCursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(c: KeysetCursor): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeCursor(raw: string | undefined): KeysetCursor | null {
  if (!raw) return null;
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const bar = text.indexOf('|');
  const createdAt = new Date(text.slice(0, bar));
  const id = text.slice(bar + 1);
  if (bar < 1 || !id || Number.isNaN(createdAt.getTime()))
    throw new BadRequestException({
      code: 'INVALID_CURSOR',
      message: 'cursor is not valid',
    });
  return { createdAt, id };
}

/** Prisma `where` fragment for rows strictly older than the cursor. */
export function olderThan(c: KeysetCursor | null) {
  if (!c) return {};
  return {
    OR: [
      { createdAt: { lt: c.createdAt } },
      { createdAt: c.createdAt, id: { lt: c.id } },
    ],
  };
}

/** Fetch `limit + 1` rows, then split into a page + next cursor. */
export function toPage<T extends { id: string; createdAt: Date }, V>(
  rows: T[],
  limit: number,
  map: (row: T) => V,
): { items: V[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(map),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}

/**
 * Titles for courses or lessons from ContentTranslation: the caller's
 * locale, falling back to the entity's source locale, then any locale.
 * `sourceLocales` maps entity id → its course's source locale.
 */
export async function resolveTitles(
  prisma: Pick<PrismaService, 'contentTranslation'>,
  entityType: 'COURSE' | 'LESSON',
  sourceLocales: Map<string, string>,
  locale: string,
): Promise<Map<string, string>> {
  const ids = [...sourceLocales.keys()];
  if (ids.length === 0) return new Map();
  const rows = await prisma.contentTranslation.findMany({
    where: { entityType, entityId: { in: ids }, field: 'title' },
    select: { entityId: true, locale: true, value: true },
  });
  const out = new Map<string, string>();
  for (const id of ids) {
    const mine = rows.filter((r) => r.entityId === id && r.value);
    const pick =
      mine.find((r) => r.locale === locale) ??
      mine.find((r) => r.locale === sourceLocales.get(id)) ??
      mine[0];
    if (pick) out.set(id, pick.value);
  }
  return out;
}
