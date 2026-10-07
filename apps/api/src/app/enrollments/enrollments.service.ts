import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Enrollment } from '@prisma/client';
import { enrollmentGrantsAccess } from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import type {
  EnrollmentView,
  GrantEnrollmentDto,
  MyEnrollment,
} from './enrollments.dto.js';

/** SUPPORT may grant at most this long (docs/14 §2 limits on support grants). */
export const SUPPORT_MAX_GRANT_DAYS = 31;
const DAY_MS = 86_400_000;

/**
 * Course enrollment (docs/09 §3 step 3, docs/16 §8b auto-download).
 * SELF enrollments are the student's "My courses" list and drive the
 * offline auto-download; they never grant paid access. PROMO/ADMIN_GRANT
 * enrollments grant the course while `accessUntil` is open (AccessService
 * reads them through the shared @codify/domain rule).
 */
@Injectable()
export class EnrollmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async enroll(actor: ApiUser, courseId: string): Promise<EnrollmentView> {
    await this.requirePublishedCourse(courseId);
    const row = await this.prisma.enrollment.upsert({
      where: { userId_courseId: { userId: actor.userId, courseId } },
      // An existing PROMO/ADMIN_GRANT row is kept as is: self-enrolling must
      // never downgrade a grant.
      update: {},
      create: { userId: actor.userId, courseId, source: 'SELF' },
    });
    return toView(row);
  }

  async unenroll(actor: ApiUser, courseId: string): Promise<void> {
    const row = await this.prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: actor.userId, courseId } },
    });
    if (!row) return; // idempotent
    if (row.source !== 'SELF') {
      throw new ConflictException({
        statusCode: 409,
        code: 'ENROLLMENT_GRANTED',
        message: 'This course was granted to you and cannot be removed here',
      });
    }
    await this.prisma.enrollment.delete({ where: { id: row.id } });
  }

  async listMine(actor: ApiUser, now = new Date()): Promise<MyEnrollment[]> {
    const rows = await this.prisma.enrollment.findMany({
      where: {
        userId: actor.userId,
        course: { deletedAt: null, status: 'PUBLISHED' },
      },
      include: {
        course: {
          select: {
            id: true,
            slug: true,
            sourceLocale: true,
            coverAssetId: true,
            isCapstone: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (rows.length === 0) return [];
    const courseIds = rows.map((r) => r.courseId);

    const [titles, lessons, done] = await Promise.all([
      this.prisma.contentTranslation.findMany({
        where: {
          entityType: 'COURSE',
          entityId: { in: courseIds },
          field: 'title',
        },
        select: { entityId: true, locale: true, value: true },
      }),
      this.prisma.lesson.findMany({
        where: { deletedAt: null, module: { courseId: { in: courseIds } } },
        select: { id: true, module: { select: { courseId: true } } },
      }),
      this.prisma.progress.findMany({
        where: {
          userId: actor.userId,
          lesson: { deletedAt: null, module: { courseId: { in: courseIds } } },
        },
        select: {
          lesson: { select: { module: { select: { courseId: true } } } },
        },
      }),
    ]);

    const total = countBy(lessons.map((l) => l.module.courseId));
    const completed = countBy(done.map((p) => p.lesson.module.courseId));
    return rows.map((r) => ({
      ...toView(r),
      course: {
        id: r.course.id,
        slug: r.course.slug,
        title:
          titles.find(
            (t) =>
              t.entityId === r.courseId && t.locale === r.course.sourceLocale,
          )?.value ??
          titles.find((t) => t.entityId === r.courseId)?.value ??
          r.course.slug,
        coverAssetId: r.course.coverAssetId,
        isCapstone: r.course.isCapstone,
      },
      progress: {
        completedLessons: completed.get(r.courseId) ?? 0,
        totalLessons: total.get(r.courseId) ?? 0,
      },
      grantsAccess: enrollmentGrantsAccess(
        { source: r.source, accessUntil: r.accessUntil },
        now,
      ),
    }));
  }

  // ─── Admin / support ────────────────────────────────────────────────────

  async grant(
    actor: ApiUser,
    input: GrantEnrollmentDto,
    now = new Date(),
  ): Promise<EnrollmentView> {
    const accessUntil = input.accessUntil ? new Date(input.accessUntil) : null;
    if (accessUntil && accessUntil.getTime() <= now.getTime()) {
      throw new BadRequestException('accessUntil must be in the future');
    }
    if (actor.role === 'SUPPORT') {
      if (input.source !== 'PROMO') {
        throw new ForbiddenException(
          'SUPPORT can only grant PROMO enrollments',
        );
      }
      if (
        !accessUntil ||
        accessUntil.getTime() - now.getTime() > SUPPORT_MAX_GRANT_DAYS * DAY_MS
      ) {
        throw new ForbiddenException(
          `SUPPORT grants must end within ${SUPPORT_MAX_GRANT_DAYS} days`,
        );
      }
    }
    const user = await this.prisma.user.findFirst({
      where: { id: input.userId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    await this.requirePublishedCourse(input.courseId, { allowDraft: true });

    const row = await this.prisma.enrollment.upsert({
      where: {
        userId_courseId: { userId: input.userId, courseId: input.courseId },
      },
      update: { source: input.source, accessUntil },
      create: {
        userId: input.userId,
        courseId: input.courseId,
        source: input.source,
        accessUntil,
      },
    });
    return toView(row);
  }

  async revoke(actor: ApiUser, id: string): Promise<EnrollmentView> {
    const row = await this.prisma.enrollment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Enrollment not found');
    if (actor.role === 'SUPPORT' && row.source === 'ADMIN_GRANT') {
      throw new ForbiddenException(
        'SUPPORT cannot revoke ADMIN_GRANT enrollments',
      );
    }
    await this.prisma.enrollment.delete({ where: { id } });
    return toView(row);
  }

  async listForUser(userId: string): Promise<EnrollmentView[]> {
    const rows = await this.prisma.enrollment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toView);
  }

  private async requirePublishedCourse(
    courseId: string,
    opts: { allowDraft?: boolean } = {},
  ): Promise<void> {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      select: { status: true },
    });
    if (!course || (!opts.allowDraft && course.status !== 'PUBLISHED')) {
      throw new NotFoundException('Course not found');
    }
  }
}

function toView(e: Enrollment): EnrollmentView {
  return {
    id: e.id,
    courseId: e.courseId,
    source: e.source,
    accessUntil: e.accessUntil ? e.accessUntil.toISOString() : null,
    createdAt: e.createdAt.toISOString(),
  };
}

function countBy(keys: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}
