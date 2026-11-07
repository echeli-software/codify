import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiUser } from '../auth/auth.types.js';
import type { SearchHit, SearchResponse } from './admin-ops.dto.js';
import { resolveTitles } from './admin-ops.util.js';

/** Results per entity type. */
export const SEARCH_LIMIT = 5;
export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_CHARS = 100;
/** Title matches considered before scoping/limiting. */
const TITLE_CANDIDATES = 50;

const ci = (q: string) => ({ contains: q, mode: 'insensitive' as const });

/**
 * Which entity types each staff role may search — mirrors the admin
 * sections they can open (docs/04 §1): TEACHER only their own courses and
 * lessons; SUPPORT courses + users; ADMIN everything.
 */
export function searchableTypes(role: ApiUser['role']) {
  return {
    courses: role !== 'STUDENT',
    lessons: role === 'ADMIN' || role === 'TEACHER',
    users: role === 'ADMIN' || role === 'SUPPORT',
    items: role === 'ADMIN',
    badges: role === 'ADMIN',
  };
}

/**
 * GET /admin/search?q= — the Cmd/Ctrl-K palette (docs/04 §6). Case-
 * insensitive substring match on names/titles (titles through the
 * ContentTranslation table, any locale) and slugs, plus exact ids; at
 * most {@link SEARCH_LIMIT} hits per type.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    actor: ApiUser,
    rawQ: string | undefined,
    locale: string,
  ): Promise<SearchResponse> {
    const q = (rawQ ?? '').trim();
    if (q.length < SEARCH_MIN_CHARS || q.length > SEARCH_MAX_CHARS)
      throw new BadRequestException({
        code: 'INVALID_QUERY',
        message: `q must be ${SEARCH_MIN_CHARS}–${SEARCH_MAX_CHARS} characters`,
      });
    const allowed = searchableTypes(actor.role);
    const authorId = actor.role === 'TEACHER' ? actor.userId : undefined;
    const [courses, lessons, users, items, badges] = await Promise.all([
      allowed.courses ? this.courses(q, locale, authorId) : [],
      allowed.lessons ? this.lessons(q, locale, authorId) : [],
      allowed.users ? this.users(q) : [],
      allowed.items ? this.items(q) : [],
      allowed.badges ? this.badges(q) : [],
    ]);
    return { q, courses, lessons, users, items, badges };
  }

  private async titleMatches(
    entityType: 'COURSE' | 'LESSON',
    q: string,
  ): Promise<string[]> {
    const rows = await this.prisma.contentTranslation.findMany({
      where: { entityType, field: 'title', value: ci(q) },
      select: { entityId: true },
      distinct: ['entityId'],
      take: TITLE_CANDIDATES,
    });
    return rows.map((r) => r.entityId);
  }

  private async courses(
    q: string,
    locale: string,
    authorId?: string,
  ): Promise<SearchHit[]> {
    const ids = await this.titleMatches('COURSE', q);
    const rows = await this.prisma.course.findMany({
      where: {
        deletedAt: null,
        ...(authorId ? { authorId } : {}),
        OR: [{ slug: ci(q) }, { id: { in: [...ids, q] } }],
      },
      select: { id: true, slug: true, sourceLocale: true },
      orderBy: { updatedAt: 'desc' },
      take: SEARCH_LIMIT,
    });
    const titles = await resolveTitles(
      this.prisma,
      'COURSE',
      new Map(rows.map((r) => [r.id, r.sourceLocale])),
      locale,
    );
    return rows.map((r) => ({
      type: 'course',
      id: r.id,
      title: titles.get(r.id) ?? r.slug,
      subtitle: r.slug,
    }));
  }

  private async lessons(
    q: string,
    locale: string,
    authorId?: string,
  ): Promise<SearchHit[]> {
    const ids = await this.titleMatches('LESSON', q);
    const rows = await this.prisma.lesson.findMany({
      where: {
        deletedAt: null,
        id: { in: [...ids, q] },
        module: {
          course: { deletedAt: null, ...(authorId ? { authorId } : {}) },
        },
      },
      select: {
        id: true,
        module: {
          select: { course: { select: { slug: true, sourceLocale: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: SEARCH_LIMIT,
    });
    const titles = await resolveTitles(
      this.prisma,
      'LESSON',
      new Map(rows.map((r) => [r.id, r.module.course.sourceLocale])),
      locale,
    );
    return rows.map((r) => ({
      type: 'lesson',
      id: r.id,
      title: titles.get(r.id) ?? r.id,
      subtitle: r.module.course.slug,
      courseSlug: r.module.course.slug,
    }));
  }

  private async users(q: string): Promise<SearchHit[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        OR: [{ email: ci(q) }, { displayName: ci(q) }, { id: q }],
      },
      select: { id: true, displayName: true, email: true },
      orderBy: { createdAt: 'desc' },
      take: SEARCH_LIMIT,
    });
    return rows.map((r) => ({
      type: 'user',
      id: r.id,
      title: r.displayName,
      subtitle: r.email,
    }));
  }

  private async items(q: string): Promise<SearchHit[]> {
    const rows = await this.prisma.item.findMany({
      where: {
        deletedAt: null,
        OR: [{ name: ci(q) }, { slug: ci(q) }, { id: q }],
      },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
      take: SEARCH_LIMIT,
    });
    return rows.map((r) => ({
      type: 'item',
      id: r.id,
      title: r.name,
      subtitle: r.slug,
    }));
  }

  private async badges(q: string): Promise<SearchHit[]> {
    const rows = await this.prisma.badge.findMany({
      where: { OR: [{ name: ci(q) }, { slug: ci(q) }, { id: q }] },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
      take: SEARCH_LIMIT,
    });
    return rows.map((r) => ({
      type: 'badge',
      id: r.id,
      title: r.name,
      subtitle: r.slug,
    }));
  }
}
