import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

type Db = Pick<PrismaService, '$queryRaw'>;

/**
 * Courses each user has completed: every live lesson (lesson and module
 * not soft-deleted) of the course has a Progress row. One query for all
 * `userIds`; users with none are absent from the map.
 */
export async function coursesCompleted(
  prisma: Db,
  userIds: readonly string[],
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ userId: string; n: number }[]>`
    WITH totals AS (
      SELECT m."courseId", COUNT(*)::int AS total
      FROM "Lesson" l
      JOIN "Module" m ON m.id = l."moduleId" AND m."deletedAt" IS NULL
      WHERE l."deletedAt" IS NULL
      GROUP BY m."courseId"
    ), done AS (
      SELECT p."userId", m."courseId", COUNT(DISTINCT p."lessonId")::int AS done
      FROM "Progress" p
      JOIN "Lesson" l ON l.id = p."lessonId" AND l."deletedAt" IS NULL
      JOIN "Module" m ON m.id = l."moduleId" AND m."deletedAt" IS NULL
      WHERE p."userId" IN (${Prisma.join([...userIds])})
      GROUP BY p."userId", m."courseId"
    )
    SELECT d."userId", COUNT(*)::int AS n
    FROM done d JOIN totals t ON t."courseId" = d."courseId"
    WHERE t.total > 0 AND d.done >= t.total
    GROUP BY d."userId"`;
  return new Map(rows.map((r) => [r.userId, Number(r.n)]));
}

/**
 * Titles from ContentTranslation for COURSE / MODULE / LESSON ids: the
 * wanted locale, else the course's source locale, else any locale.
 */
export async function contentTitles(
  prisma: Pick<PrismaService, 'contentTranslation'>,
  entityType: 'COURSE' | 'MODULE' | 'LESSON',
  sourceLocales: ReadonlyMap<string, string>,
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
