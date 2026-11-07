import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';
import type { ApiUserRole } from './types.js';

// ─── Shared ────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: ApiUserRole | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  /** Free-form JSON (often `{ before, after }`). */
  diff: unknown;
  ip: string | null;
  userAgent: string | null;
}

export interface CursorPage<T> {
  items: T[];
  /** Pass back as `cursor` for the next (older) page; null on the last. */
  nextCursor: string | null;
}

// ─── Dashboard ─────────────────────────────────────────────────────────────

export interface DashboardTopCourse {
  courseId: string;
  slug: string;
  title: string;
  enrolled: number;
  completed: number;
  /** 0–1. */
  completionRate: number;
}

export interface AdminDashboardKpis {
  wau: number;
  mau: number;
  paidConversionsThisWeek: number;
  activeSubscriptions: number;
  trialingSubscriptions: number;
  mrr: {
    currency: 'BRL';
    amountCents: number;
    /** Active subscriptions without a BRL price (no FX conversion). */
    excludedSubscriptions: number;
  };
  topCourses: DashboardTopCourse[];
}

export interface DashboardDropOffLesson {
  lessonId: string;
  title: string;
  courseSlug: string;
  started: number;
  completed: number;
  /** 0–1. */
  dropOffRate: number;
}

export interface TeacherDashboardKpis {
  enrollmentsToday: number;
  enrollmentsTodayByCourse: {
    courseId: string;
    title: string;
    count: number;
  }[];
  topDropOffLessons: DashboardDropOffLesson[];
  pendingTranslations: number;
}

export interface AdminDashboard {
  scope: 'admin' | 'teacher';
  generatedAt: string;
  weekStart: string;
  admin: AdminDashboardKpis | null;
  teacher: TeacherDashboardKpis | null;
  recentActivity: AuditEntry[];
}

// ─── Search ────────────────────────────────────────────────────────────────

export type AdminSearchHitType =
  | 'course'
  | 'lesson'
  | 'user'
  | 'item'
  | 'badge';

export interface AdminSearchHit {
  type: AdminSearchHitType;
  id: string;
  title: string;
  subtitle: string | null;
  courseSlug?: string | null;
}

export interface AdminSearchResults {
  q: string;
  courses: AdminSearchHit[];
  lessons: AdminSearchHit[];
  users: AdminSearchHit[];
  items: AdminSearchHit[];
  badges: AdminSearchHit[];
}

// ─── Audit ─────────────────────────────────────────────────────────────────

export interface AuditQuery {
  actorId?: string;
  /** Prefix match (`user.` → every user action). */
  action?: string;
  entityType?: string;
  entityId?: string;
  /** ISO-8601. */
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface AuditExport {
  blob: Blob;
  filename: string;
  rows: number;
  truncated: boolean;
}

// ─── Leagues ───────────────────────────────────────────────────────────────

export type AdminLeagueTier =
  | 'BRONZE'
  | 'SILVER'
  | 'GOLD'
  | 'PLATINUM'
  | 'DIAMOND';

export interface LeagueSnapshot {
  weekStart: string;
  tiers: {
    tier: AdminLeagueTier;
    leagues: number;
    members: number;
    p50WeeklyXp: number;
    p95WeeklyXp: number;
  }[];
  leagues: {
    id: string;
    tier: AdminLeagueTier;
    cohortKey: string;
    members: number;
    topWeeklyXp: number;
  }[];
  rules: {
    cohortCapacity: number;
    promoteCount: number;
    demoteCount: number;
    minCohortForDemotion: number;
    promotionReward: { xp: number; coins: number; freeze: number };
    rank1Reward: { xp: number; coins: number };
  };
}

export interface LeagueDetail {
  id: string;
  tier: AdminLeagueTier;
  weekStart: string;
  cohortKey: string;
  promoteZone: number;
  demoteZone: number;
  members: {
    rank: number;
    userId: string;
    displayName: string;
    weeklyXp: number;
    zone: 'promote' | 'demote' | 'stay';
    finalRank: number | null;
    promoted: boolean | null;
    demoted: boolean | null;
  }[];
}

// ─── Users: inventory + ledger ─────────────────────────────────────────────

export interface UserInventoryEntry {
  itemId: string;
  slug: string;
  name: string;
  slot: string;
  rarity: string;
  categorySlug: string;
  spriteAssetId: string;
  source: string;
  acquiredAt: string;
  equipped: boolean;
}

export interface GrantItemResult {
  entry: UserInventoryEntry;
  alreadyOwned: boolean;
}

export type LedgerType = 'coins' | 'xp';

export interface LedgerEntry {
  id: string;
  createdAt: string;
  delta: number;
  balanceAfter: number;
  source: string;
  multiplier: string | null;
  refType: string | null;
  refId: string | null;
}

export interface LedgerPage extends CursorPage<LedgerEntry> {
  type: LedgerType;
  balance: number;
}

// ─── Badge test ────────────────────────────────────────────────────────────

export interface BadgeTestResult {
  badgeId: string;
  userId: string;
  wouldUnlock: boolean;
  alreadyEarned: boolean;
  awardedAt: string | null;
  badgeActive: boolean;
  mode: 'all' | 'any' | 'none';
  clauses: {
    kind: 'event' | 'metric';
    key: string;
    predicate: Record<string, number>;
    value: number;
    passed: boolean;
  }[];
  events: Record<string, number>;
  metrics: Record<string, number>;
}

// ─── Item categories ───────────────────────────────────────────────────────

export interface ItemCategoryAdmin {
  slug: string;
  name: string;
  sortOrder: number;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

function params(q: object): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(q))
    if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
  return p;
}

/** Filename from `Content-Disposition: attachment; filename="x.csv"`. */
export function filenameFromDisposition(
  header: string | null,
  fallback: string,
): string {
  const m = header?.match(/filename="?([^";]+)"?/i);
  return m?.[1] ?? fallback;
}

/**
 * Typed client for the admin operations endpoints (docs/04): dashboard,
 * global search, audit, leagues, user inventory/ledger, badge test and
 * item categories.
 */
@Injectable({ providedIn: 'root' })
export class AdminOpsClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);
  private get base() {
    return `${this.config.baseUrl}/admin`;
  }

  /** GET /admin/dashboard — scope follows the caller's role. */
  dashboard(): Promise<AdminDashboard> {
    return firstValueFrom(
      this.http.get<AdminDashboard>(`${this.base}/dashboard`),
    );
  }

  /** GET /admin/search?q= — ≥ 2 chars; ≤ 5 hits per type. */
  search(q: string): Promise<AdminSearchResults> {
    return firstValueFrom(
      this.http.get<AdminSearchResults>(`${this.base}/search`, {
        params: params({ q }),
      }),
    );
  }

  audit(query: AuditQuery = {}): Promise<CursorPage<AuditEntry>> {
    return firstValueFrom(
      this.http.get<CursorPage<AuditEntry>>(`${this.base}/audit`, {
        params: params(query),
      }),
    );
  }

  /** CSV of the filtered log (row-capped server-side). */
  async auditExport(
    query: Omit<AuditQuery, 'cursor' | 'limit'> = {},
  ): Promise<AuditExport> {
    const res = await firstValueFrom(
      this.http.get(`${this.base}/audit/export`, {
        params: params(query),
        observe: 'response',
        responseType: 'blob',
      }),
    );
    return {
      blob: res.body ?? new Blob([], { type: 'text/csv' }),
      filename: filenameFromDisposition(
        res.headers.get('Content-Disposition'),
        'audit.csv',
      ),
      rows: Number(res.headers.get('X-Export-Rows') ?? 0),
      truncated: res.headers.get('X-Export-Truncated') === 'true',
    };
  }

  leagueSnapshot(weekStart?: string): Promise<LeagueSnapshot> {
    return firstValueFrom(
      this.http.get<LeagueSnapshot>(`${this.base}/leagues/snapshot`, {
        params: params({ weekStart }),
      }),
    );
  }

  league(id: string): Promise<LeagueDetail> {
    return firstValueFrom(
      this.http.get<LeagueDetail>(
        `${this.base}/leagues/${encodeURIComponent(id)}`,
      ),
    );
  }

  userItems(userId: string): Promise<UserInventoryEntry[]> {
    return firstValueFrom(
      this.http.get<UserInventoryEntry[]>(
        `${this.base}/users/${encodeURIComponent(userId)}/items`,
      ),
    );
  }

  /** ADMIN. Idempotent: an owned item comes back with `alreadyOwned`. */
  grantItem(
    userId: string,
    body: { itemId: string; reason: string },
  ): Promise<GrantItemResult> {
    return firstValueFrom(
      this.http.post<GrantItemResult>(
        `${this.base}/users/${encodeURIComponent(userId)}/items`,
        body,
        { context: withIdempotency() },
      ),
    );
  }

  ledger(
    userId: string,
    query: { type: LedgerType; cursor?: string; limit?: number },
  ): Promise<LedgerPage> {
    return firstValueFrom(
      this.http.get<LedgerPage>(
        `${this.base}/users/${encodeURIComponent(userId)}/ledger`,
        { params: params(query) },
      ),
    );
  }

  /** Simulate a badge rule for a user; nothing is awarded. */
  testBadge(badgeId: string, userId: string): Promise<BadgeTestResult> {
    return firstValueFrom(
      this.http.post<BadgeTestResult>(
        `${this.base}/badges/${encodeURIComponent(badgeId)}/test`,
        { userId },
      ),
    );
  }

  itemCategories(): Promise<ItemCategoryAdmin[]> {
    return firstValueFrom(
      this.http.get<ItemCategoryAdmin[]>(`${this.base}/item-categories`),
    );
  }

  createItemCategory(body: {
    slug: string;
    name: string;
    sortOrder?: number;
  }): Promise<ItemCategoryAdmin> {
    return firstValueFrom(
      this.http.post<ItemCategoryAdmin>(`${this.base}/item-categories`, body, {
        context: withIdempotency(),
      }),
    );
  }

  updateItemCategory(
    slug: string,
    body: { name?: string; sortOrder?: number },
  ): Promise<ItemCategoryAdmin> {
    return firstValueFrom(
      this.http.patch<ItemCategoryAdmin>(
        `${this.base}/item-categories/${encodeURIComponent(slug)}`,
        body,
      ),
    );
  }

  deleteItemCategory(slug: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(
        `${this.base}/item-categories/${encodeURIComponent(slug)}`,
      ),
    );
  }
}
