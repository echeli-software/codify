import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ApiUser } from '../auth/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * TEACHER ownership rules for authoring endpoints (docs/14 §2): a TEACHER
 * may only touch content inside courses they author; ADMIN may touch
 * anything. Other roles never reach these endpoints (@Roles), but are
 * rejected here as well for defence in depth.
 */
export function assertCanManageCourse(
  actor: ApiUser,
  course: { authorId: string } | null | undefined,
): void {
  if (actor.role === 'ADMIN') return;
  if (actor.role === 'TEACHER' && course && course.authorId === actor.userId)
    return;
  throw new ForbiddenException(
    'You can only manage content in your own courses',
  );
}

type Db = Pick<PrismaService, 'lesson'>;

/** The lesson (with its course) an author wants to manage, ownership-checked. */
export async function lessonForAuthor(
  prisma: Db,
  actor: ApiUser,
  lessonId: string,
) {
  const lesson = await prisma.lesson.findFirst({
    where: { id: lessonId, deletedAt: null },
    include: {
      module: {
        include: {
          course: { select: { id: true, authorId: true, status: true } },
        },
      },
    },
  });
  if (!lesson) throw new NotFoundException('Lesson not found');
  assertCanManageCourse(actor, lesson.module.course);
  return lesson;
}

/**
 * Ownership check for an attached entity (exercise / AI prompt / scenario)
 * addressed by its own id. Entities not attached to any lesson are
 * ADMIN-only.
 */
export async function assertCanManageAttached(
  prisma: Db,
  actor: ApiUser,
  where:
    | { exerciseId: string }
    | { aiPromptId: string }
    | { scenarioId: string },
): Promise<void> {
  if (actor.role === 'ADMIN') return;
  const lesson = await prisma.lesson.findFirst({
    where,
    select: { module: { select: { course: { select: { authorId: true } } } } },
  });
  assertCanManageCourse(actor, lesson?.module.course);
}
