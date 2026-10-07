import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Course, Module as PrismaModule, Prisma } from '@prisma/client';
import {
  LESSON_DOC_MAX_BYTES,
  LessonDocMigrationError,
  buildQuizAnswerHashes,
  collectLessonRefs,
  emptyLessonDoc,
  migrateLessonDoc,
  stripQuizAnswers,
  validateLessonDoc,
  type LessonDoc,
  type LessonDocIssue,
} from '@codify/lesson-schema';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessService } from '../billing/access.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import type {
  CreateLessonDto,
  LessonMeta,
  LessonOfflineBundle,
  LessonResponse,
  LessonVersion,
  UpdateLessonDto,
} from './lessons.dto.js';

type LessonWithCourse = Prisma.LessonGetPayload<{
  include: { module: { include: { course: true } } };
}>;

function invalidContent(issues: LessonDocIssue[]): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: 'Invalid lesson content',
    issues,
  });
}

@Injectable()
export class LessonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async create(
    actor: ApiUser,
    moduleId: string,
    input: CreateLessonDto,
  ): Promise<LessonResponse> {
    const { course, module: parent } = await this.requireModuleAccess(
      actor,
      moduleId,
      'write',
    );
    const order = input.order ?? (await this.nextOrder(parent.id));
    const content =
      input.contentJson !== undefined
        ? await this.prepareContent(input.contentJson)
        : (emptyLessonDoc(
            course.sourceLocale,
          ) as unknown as Prisma.InputJsonValue);

    const created = await this.prisma.$transaction(async (tx) => {
      const collision = await tx.lesson.findUnique({
        where: { moduleId_order: { moduleId: parent.id, order } },
      });
      if (collision) throw new ConflictException(`Lesson order ${order} taken`);

      const lesson = await tx.lesson.create({
        data: {
          moduleId: parent.id,
          order,
          type: input.type ?? 'READING',
          isFree: input.isFree ?? false,
          estimatedMinutes: input.estimatedMinutes ?? 5,
          baseXp: input.baseXp ?? 10,
          baseCoins: input.baseCoins ?? 5,
          contentJson: content,
        },
      });
      await tx.contentTranslation.create({
        data: {
          entityType: 'LESSON',
          entityId: lesson.id,
          locale: course.sourceLocale,
          field: 'title',
          value: input.title,
        },
      });
      return lesson;
    });

    return this.byId(actor, created.id);
  }

  /**
   * GET /lessons/:id. Staff get the authored doc. Students:
   *   - draft / archived course → 404 (never reveal unpublished content);
   *   - no access → 402 with `reason` + `requiredPlans` (same body as the
   *     progress endpoint) and NO contentJson;
   *   - access → the doc with quiz answer keys stripped.
   */
  async getById(actor: ApiUser, id: string): Promise<LessonResponse> {
    if (actor.role !== 'STUDENT') return this.byId(actor, id);
    const l = await this.loadForStudent(id);
    await this.assertStudentAccess(actor, l);
    const meta = await this.meta(l);
    return {
      ...meta,
      contentJson: stripQuizAnswers(this.readDoc(l.contentJson)),
    };
  }

  /**
   * GET /lessons/:id/offline-bundle (docs/16 §5). Same gating as
   * `getById`; returns the stripped doc plus per-question answer hashes for
   * instant offline feedback. The server still grades every attempt.
   */
  async offlineBundle(
    actor: ApiUser,
    id: string,
  ): Promise<LessonOfflineBundle> {
    let l: LessonWithCourse;
    if (actor.role === 'STUDENT') {
      l = await this.loadForStudent(id);
      await this.assertStudentAccess(actor, l);
    } else {
      l = await this.load(id);
    }
    const doc = this.readDoc(l.contentJson);
    const salt = randomUUID();
    const meta = await this.meta(l);
    return {
      lesson: meta,
      doc: stripQuizAnswers(doc),
      quizAnswerHashes: {
        algorithm: 'sha256',
        salt,
        hashes: await buildQuizAnswerHashes(doc, salt),
      },
      imageSrcs: collectLessonRefs(doc).imageSrcs,
      updatedAt: meta.updatedAt,
    };
  }

  /**
   * GET /courses/:id/lesson-versions — `updatedAt` per live lesson so a
   * downloaded course re-fetches only what changed. Metadata only (no
   * content), so no paywall check; unpublished courses 404 for students.
   */
  async lessonVersions(
    actor: ApiUser,
    courseId: string,
  ): Promise<LessonVersion[]> {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (
      !course ||
      (actor.role === 'STUDENT' && course.status !== 'PUBLISHED')
    ) {
      throw new NotFoundException('Course not found');
    }
    const rows = await this.prisma.lesson.findMany({
      where: { deletedAt: null, module: { courseId } },
      select: { id: true, updatedAt: true },
      orderBy: [{ module: { order: 'asc' } }, { order: 'asc' }],
    });
    return rows.map((r) => ({
      lessonId: r.id,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async update(
    actor: ApiUser,
    id: string,
    patch: UpdateLessonDto,
  ): Promise<LessonResponse> {
    const target = await this.prisma.lesson.findFirst({
      where: { id, deletedAt: null },
      include: { module: { include: { course: true } } },
    });
    if (!target) throw new NotFoundException('Lesson not found');
    await this.requireModuleAccess(actor, target.moduleId, 'write');
    const content =
      patch.contentJson !== undefined
        ? await this.prepareContent(patch.contentJson)
        : undefined;

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.LessonUpdateInput = {};
      if (patch.type !== undefined) data.type = patch.type;
      if (patch.isFree !== undefined) data.isFree = patch.isFree;
      if (patch.estimatedMinutes !== undefined)
        data.estimatedMinutes = patch.estimatedMinutes;
      if (patch.baseXp !== undefined) data.baseXp = patch.baseXp;
      if (patch.baseCoins !== undefined) data.baseCoins = patch.baseCoins;
      if (content !== undefined) data.contentJson = content;
      // The title lives in ContentTranslation; bump updatedAt anyway so
      // offline clients (lesson-versions) notice the change.
      if (patch.title !== undefined) data.updatedAt = new Date();

      if (typeof patch.order === 'number' && patch.order !== target.order) {
        const collision = await tx.lesson.findUnique({
          where: {
            moduleId_order: { moduleId: target.moduleId, order: patch.order },
          },
        });
        if (collision)
          throw new ConflictException(`Lesson order ${patch.order} taken`);
        data.order = patch.order;
      }

      if (Object.keys(data).length > 0) {
        await tx.lesson.update({ where: { id }, data });
      }

      if (data.contentJson !== undefined) {
        // The source body changed: every translated body is now stale.
        await tx.contentTranslation.updateMany({
          where: {
            entityType: 'LESSON',
            entityId: id,
            field: 'contentJson',
            locale: { not: target.module.course.sourceLocale },
          },
          data: { outdated: true },
        });
      }

      if (patch.title !== undefined) {
        await tx.contentTranslation.upsert({
          where: {
            entityType_entityId_locale_field: {
              entityType: 'LESSON',
              entityId: id,
              locale: target.module.course.sourceLocale,
              field: 'title',
            },
          },
          update: { value: patch.title, outdated: false },
          create: {
            entityType: 'LESSON',
            entityId: id,
            locale: target.module.course.sourceLocale,
            field: 'title',
            value: patch.title,
          },
        });
        await tx.contentTranslation.updateMany({
          where: {
            entityType: 'LESSON',
            entityId: id,
            field: 'title',
            locale: { not: target.module.course.sourceLocale },
          },
          data: { outdated: true },
        });
      }
    });

    return this.byId(actor, id);
  }

  async softDelete(actor: ApiUser, id: string): Promise<void> {
    const target = await this.prisma.lesson.findFirst({
      where: { id, deletedAt: null },
      include: { module: true },
    });
    if (!target) throw new NotFoundException('Lesson not found');
    await this.requireModuleAccess(actor, target.moduleId, 'write');
    await this.prisma.lesson.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private async byId(actor: ApiUser, id: string): Promise<LessonResponse> {
    const l = await this.load(id);
    if (actor.role === 'STUDENT' && l.module.course.status !== 'PUBLISHED') {
      throw new NotFoundException('Lesson not found');
    }
    return { ...(await this.meta(l)), contentJson: l.contentJson };
  }

  private async load(id: string): Promise<LessonWithCourse> {
    const l = await this.prisma.lesson.findFirst({
      where: { id, deletedAt: null },
      include: { module: { include: { course: true } } },
    });
    if (!l || l.module.course.deletedAt) {
      throw new NotFoundException('Lesson not found');
    }
    return l;
  }

  private async loadForStudent(id: string): Promise<LessonWithCourse> {
    const l = await this.load(id);
    if (l.module.course.status !== 'PUBLISHED') {
      throw new NotFoundException('Lesson not found');
    }
    return l;
  }

  /** 402 unless the student may read this lesson (free / enrolled / plan). */
  private async assertStudentAccess(
    actor: ApiUser,
    l: LessonWithCourse,
  ): Promise<void> {
    if (l.isFree) return;
    const { access } = await this.access.resolveLessonAccess(
      actor.userId,
      l.id,
    );
    if (!access.granted) {
      throw new HttpException(
        {
          statusCode: 402,
          message: 'Subscription required',
          reason: access.reason,
          requiredPlans: access.requiredPlans ?? [],
        },
        402,
      );
    }
  }

  private async meta(l: LessonWithCourse): Promise<LessonMeta> {
    const titleRow = await this.prisma.contentTranslation.findUnique({
      where: {
        entityType_entityId_locale_field: {
          entityType: 'LESSON',
          entityId: l.id,
          locale: l.module.course.sourceLocale,
          field: 'title',
        },
      },
    });
    return {
      id: l.id,
      moduleId: l.moduleId,
      courseId: l.module.courseId,
      order: l.order,
      type: l.type,
      isFree: l.isFree,
      estimatedMinutes: l.estimatedMinutes,
      baseXp: l.baseXp,
      baseCoins: l.baseCoins,
      title: titleRow?.value ?? `Lesson ${l.order + 1}`,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    };
  }

  /**
   * Stored doc → current version for delivery. Legacy docs that no longer
   * migrate cleanly are served as stored rather than failing the read.
   */
  private readDoc(raw: unknown): LessonDoc {
    try {
      return migrateLessonDoc(raw as LessonDoc, { validate: null });
    } catch {
      return raw as LessonDoc;
    }
  }

  /**
   * Incoming doc → persisted doc: size cap, migrate to the current
   * version, validate with `lessonDocSchema` (400 + issues), check that
   * referenced exercises / AI prompts / scenarios exist. Returns the
   * whitelisted parse output.
   */
  private async prepareContent(raw: unknown): Promise<Prisma.InputJsonValue> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw invalidContent([
        {
          path: '',
          code: 'invalid_type',
          message: 'contentJson must be a LessonDoc object',
        },
      ]);
    }
    if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > LESSON_DOC_MAX_BYTES) {
      throw new PayloadTooLargeException(
        `Lesson content exceeds ${LESSON_DOC_MAX_BYTES} bytes; split it into several lessons`,
      );
    }
    let migrated: LessonDoc;
    try {
      migrated = migrateLessonDoc(raw as LessonDoc);
    } catch (err) {
      if (err instanceof LessonDocMigrationError) {
        throw invalidContent(
          err.issues.length
            ? err.issues
            : [{ path: 'version', code: 'custom', message: err.message }],
        );
      }
      throw err;
    }
    const result = validateLessonDoc(migrated);
    if (!result.ok) throw invalidContent(result.issues);
    await this.assertRefsExist(result.doc as unknown as LessonDoc);
    return result.doc as unknown as Prisma.InputJsonValue;
  }

  /** docs/06 §6: ref blocks must point at existing rows. */
  private async assertRefsExist(doc: LessonDoc): Promise<void> {
    const refs = collectLessonRefs(doc);
    const [exercises, prompts, scenarios] = await Promise.all([
      refs.exerciseIds.length
        ? this.prisma.exercise.findMany({
            where: { id: { in: refs.exerciseIds } },
            select: { id: true },
          })
        : [],
      refs.aiPromptIds.length
        ? this.prisma.aiPrompt.findMany({
            where: { id: { in: refs.aiPromptIds } },
            select: { id: true },
          })
        : [],
      refs.scenarioIds.length
        ? this.prisma.scenario.findMany({
            where: { id: { in: refs.scenarioIds } },
            select: { id: true },
          })
        : [],
    ]);
    const issues: LessonDocIssue[] = [];
    const missing = (
      ids: string[],
      found: { id: string }[],
      label: string,
    ): void => {
      const have = new Set(found.map((f) => f.id));
      for (const id of ids) {
        if (!have.has(id)) {
          issues.push({
            path: label,
            code: 'unknown_reference',
            message: `Unknown ${label} "${id}"`,
          });
        }
      }
    };
    missing(refs.exerciseIds, exercises, 'exerciseId');
    missing(refs.aiPromptIds, prompts, 'aiPromptId');
    missing(refs.scenarioIds, scenarios, 'scenarioId');
    if (issues.length) throw invalidContent(issues);
  }

  private async nextOrder(moduleId: string): Promise<number> {
    const top = await this.prisma.lesson.findFirst({
      where: { moduleId, deletedAt: null },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return (top?.order ?? -1) + 1;
  }

  private async requireModuleAccess(
    actor: ApiUser,
    moduleId: string,
    mode: 'read' | 'write',
  ): Promise<{ module: PrismaModule; course: Course }> {
    const m = await this.prisma.module.findUnique({
      where: { id: moduleId },
      include: { course: true },
    });
    if (!m) throw new NotFoundException('Module not found');
    if (m.course.deletedAt) throw new NotFoundException('Course not found');
    if (mode === 'write') {
      if (actor.role !== 'ADMIN' && actor.role !== 'TEACHER') {
        throw new ForbiddenException('Only ADMIN/TEACHER can edit lessons');
      }
      if (actor.role === 'TEACHER' && m.course.authorId !== actor.userId) {
        throw new ForbiddenException(
          'Teachers can only edit their own courses',
        );
      }
    } else if (actor.role === 'STUDENT' && m.course.status !== 'PUBLISHED') {
      throw new NotFoundException('Module not found');
    }
    return { module: m, course: m.course };
  }
}
