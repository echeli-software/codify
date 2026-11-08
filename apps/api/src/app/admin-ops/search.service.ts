import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

/**
 * Case-insensitive substring filter. Prisma passes `contains` into LIKE
 * unescaped, so `%` / `_` / `\` in the query are escaped to match literally.
 */
const ci = (q: string) => ({
  contains: q.replace(/[\\%_]/g, (c) => `\\${c}`),
  mode: 'insensitive' as const,
});

/** Characters of the body snippet shown in the palette. */
export const SNIPPET_CHARS = 80;

/** `q` as an ILIKE substring pattern (wildcards in `q` match literally). */
export function ilikePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** ~SNIPPET_CHARS of `text` around the first case-insensitive `q`. */
export function snippetAround(text: string, q: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(q.toLowerCase());
  if (flat.length <= SNIPPET_CHARS || at < 0)
    return flat.length <= SNIPPET_CHARS
      ? flat
      : `${flat.slice(0, SNIPPET_CHARS - 1)}…`;
  const start = Math.max(0, at - Math.floor((SNIPPET_CHARS - q.length) / 2));
  const end = Math.min(flat.length, start + SNIPPET_CHARS);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

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
 * most {@link SEARCH_LIMIT} hits per type. Lessons also match on their
 * body text (docs/06 §11 deep content search, see `bodyMatches`).
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
    const [ids, body] = await Promise.all([
      this.titleMatches('LESSON', q),
      this.bodyMatches(q, authorId),
    ]);
    const rows = await this.prisma.lesson.findMany({
      where: {
        deletedAt: null,
        id: { in: [...new Set([...ids, ...body.keys(), q])] },
        module: {
          deletedAt: null,
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
      take: TITLE_CANDIDATES,
    });
    const titles = await resolveTitles(
      this.prisma,
      'LESSON',
      new Map(rows.map((r) => [r.id, r.module.course.sourceLocale])),
      locale,
    );
    // Title / id matches first, then body-only matches.
    const titleIds = new Set([...ids, q]);
    return rows
      .map((r) => {
        const snippet = titleIds.has(r.id) ? null : (body.get(r.id) ?? null);
        return {
          type: 'lesson' as const,
          id: r.id,
          title: titles.get(r.id) ?? r.id,
          subtitle: snippet
            ? `${r.module.course.slug} · “${snippetAround(snippet, q)}”`
            : r.module.course.slug,
          courseSlug: r.module.course.slug,
          ...(snippet ? { match: 'content' as const } : {}),
        };
      })
      .sort((a, b) => Number(!!a.match) - Number(!!b.match))
      .slice(0, SEARCH_LIMIT);
  }

  /**
   * Deep content search (docs/06 §11): lessons whose body — the source
   * `contentJson` or a translated body (ContentTranslation rows holding
   * JSON) — has a user-visible string containing `q` (case-insensitive):
   * text nodes, quiz questions / options / explanations, image alt +
   * captions, embed / video titles. Extracted with `jsonb_path_query`, so
   * keys, ids and URLs never match. Scoped like the title search (teachers:
   * own courses). Returns lesson id → the first matching string.
   */
  private async bodyMatches(
    q: string,
    authorId?: string,
  ): Promise<Map<string, string>> {
    const pattern = ilikePattern(q);
    const author = authorId
      ? Prisma.sql`AND c."authorId" = ${authorId}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ id: string; hit: string }[]>`
      WITH docs AS (
        SELECT l.id, l."updatedAt", l."contentJson" AS doc
        FROM "Lesson" l
        JOIN "Module" m ON m.id = l."moduleId"
        JOIN "Course" c ON c.id = m."courseId"
        WHERE l."deletedAt" IS NULL AND m."deletedAt" IS NULL
          AND c."deletedAt" IS NULL ${author}
        UNION ALL
        SELECT l.id, l."updatedAt",
          CASE WHEN ct.value IS JSON OBJECT THEN ct.value::jsonb END AS doc
        FROM "ContentTranslation" ct
        JOIN "Lesson" l ON l.id = ct."entityId"
        JOIN "Module" m ON m.id = l."moduleId"
        JOIN "Course" c ON c.id = m."courseId"
        WHERE ct."entityType" = 'LESSON' AND ct.field = 'contentJson'
          AND l."deletedAt" IS NULL AND m."deletedAt" IS NULL
          AND c."deletedAt" IS NULL ${author}
      )
      SELECT DISTINCT ON (d.id) d.id, hit.s AS hit
      FROM docs d
      CROSS JOIN LATERAL (
        SELECT v #>> '{}' AS s
        FROM unnest(ARRAY[
          'strict $.**.text', 'strict $.**.question', 'strict $.**.explanation',
          'strict $.**.alt', 'strict $.**.caption', 'strict $.**.title'
        ]::jsonpath[]) AS p(path)
        CROSS JOIN LATERAL jsonb_path_query(d.doc, p.path) AS v
        WHERE jsonb_typeof(v) = 'string' AND (v #>> '{}') ILIKE ${pattern}
        LIMIT 1
      ) hit
      WHERE d.doc IS NOT NULL
      ORDER BY d.id, d."updatedAt" DESC
      LIMIT ${TITLE_CANDIDATES}
    `;
    return new Map(rows.map((r) => [r.id, r.hit]));
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
