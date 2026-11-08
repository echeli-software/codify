import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface SearchCourseHit {
  id: string;
  slug: string;
  title: string;
}

export interface SearchLessonHit {
  id: string;
  title: string;
  type: string;
  isFree: boolean;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
}

export interface CatalogSearchResponse {
  courses: SearchCourseHit[];
  lessons: SearchLessonHit[];
}

const LIMIT = 6;

function literal(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Global search of the student header (docs/05 §1): published courses and
 * lessons whose title matches in any locale. Titles are returned in the
 * caller's locale when translated, else the source locale. Titles only —
 * lesson bodies stay behind the access check of `GET /lessons/:id`.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(q: string, locale: string): Promise<CatalogSearchResponse> {
    const needle = literal(q.trim());
    if (needle.length < 2) return { courses: [], lessons: [] };
    const hits = await this.prisma.contentTranslation.findMany({
      where: {
        entityType: { in: ['COURSE', 'LESSON'] },
        field: 'title',
        value: { contains: needle, mode: 'insensitive' },
      },
      select: { entityType: true, entityId: true },
      take: 200,
    });
    const courseIds = [
      ...new Set(
        hits.filter((h) => h.entityType === 'COURSE').map((h) => h.entityId),
      ),
    ];
    const lessonIds = [
      ...new Set(
        hits.filter((h) => h.entityType === 'LESSON').map((h) => h.entityId),
      ),
    ];
    const [courses, lessons] = await Promise.all([
      this.prisma.course.findMany({
        where: {
          deletedAt: null,
          status: 'PUBLISHED',
          OR: [
            { id: { in: courseIds } },
            { slug: { contains: needle, mode: 'insensitive' } },
          ],
        },
        select: { id: true, slug: true, sourceLocale: true },
        orderBy: { publishedAt: 'desc' },
        take: LIMIT,
      }),
      lessonIds.length
        ? this.prisma.lesson.findMany({
            where: {
              id: { in: lessonIds },
              deletedAt: null,
              module: {
                deletedAt: null,
                course: { deletedAt: null, status: 'PUBLISHED' },
              },
            },
            select: {
              id: true,
              type: true,
              isFree: true,
              module: {
                select: {
                  course: {
                    select: { id: true, slug: true, sourceLocale: true },
                  },
                },
              },
            },
            take: LIMIT,
          })
        : [],
    ]);
    const ids = [
      ...courses.map((c) => c.id),
      ...lessons.map((l) => l.id),
      ...lessons.map((l) => l.module.course.id),
    ];
    const titles = ids.length
      ? await this.prisma.contentTranslation.findMany({
          where: {
            entityType: { in: ['COURSE', 'LESSON'] },
            entityId: { in: [...new Set(ids)] },
            field: 'title',
          },
          select: {
            entityType: true,
            entityId: true,
            locale: true,
            value: true,
          },
        })
      : [];
    const title = (type: string, id: string, source: string): string => {
      const rows = titles.filter(
        (t) => t.entityType === type && t.entityId === id,
      );
      return (
        rows.find((t) => t.locale === locale)?.value ??
        rows.find((t) => t.locale === source)?.value ??
        rows[0]?.value ??
        ''
      );
    };
    return {
      courses: courses.map((c) => ({
        id: c.id,
        slug: c.slug,
        title: title('COURSE', c.id, c.sourceLocale),
      })),
      lessons: lessons.map((l) => {
        const c = l.module.course;
        return {
          id: l.id,
          title: title('LESSON', l.id, c.sourceLocale),
          type: l.type,
          isFree: l.isFree,
          courseId: c.id,
          courseSlug: c.slug,
          courseTitle: title('COURSE', c.id, c.sourceLocale),
        };
      }),
    };
  }
}
