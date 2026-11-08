import type { PrismaService } from '../prisma/prisma.service.js';
import { newCard } from './reviews.logic.js';

/**
 * Create the missing review cards of a learner (docs/10 §7): one per
 * completed lesson whose content has a quiz block, in box 1, due a day
 * after the completion. Cards are created lazily — whenever mastery or the
 * review queue is read — so completions recorded anywhere (lesson, quiz,
 * offline sync) and those made before reviews existed all get one, without
 * touching the completion path. Idempotent: `@@unique(userId, lessonId)` +
 * `skipDuplicates`. Exercises, AI prompts and scenarios are not reviewed
 * (they can't be re-graded in a quick check), so only quiz blocks count.
 * Returns the number of cards created.
 */
export async function ensureReviewCards(
  prisma: Pick<PrismaService, '$queryRaw' | 'reviewCard'>,
  userId: string,
): Promise<number> {
  const missing = await prisma.$queryRaw<
    { lessonId: string; completedAt: Date }[]
  >`
    SELECT p."lessonId", p."completedAt"
    FROM "Progress" p
    JOIN "Lesson" l ON l."id" = p."lessonId"
    WHERE p."userId" = ${userId}
      AND l."deletedAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "ReviewCard" r
        WHERE r."userId" = p."userId" AND r."lessonId" = p."lessonId"
      )
      AND jsonb_path_exists(l."contentJson", '$.** ? (@.type == "quiz")')
  `;
  if (missing.length === 0) return 0;
  const created = await prisma.reviewCard.createMany({
    data: missing.map((m) => ({
      userId,
      lessonId: m.lessonId,
      ...newCard(new Date(m.completedAt)),
    })),
    skipDuplicates: true,
  });
  return created.count;
}
