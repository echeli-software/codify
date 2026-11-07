import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

// ─── Shared ────────────────────────────────────────────────────────────────

export type StaffRole = 'STUDENT' | 'TEACHER' | 'SUPPORT' | 'ADMIN';

/** One audit row as the admin app shows it (docs/04 "Audit"). */
export interface AuditEntryView {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: StaffRole | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  diff: unknown;
  ip: string | null;
  userAgent: string | null;
}

export interface Page<T> {
  items: T[];
  /** Opaque cursor for the next (older) page; null on the last page. */
  nextCursor: string | null;
}

// ─── Dashboard ─────────────────────────────────────────────────────────────

export interface TopCourseView {
  courseId: string;
  slug: string;
  title: string;
  enrolled: number;
  /** Learners who completed every live lesson of the course. */
  completed: number;
  /** completed / enrolled, 0–1 (0 when nobody is enrolled). */
  completionRate: number;
}

export interface AdminDashboardKpis {
  /** Distinct students active in the last 7 / 30 days. */
  wau: number;
  mau: number;
  /** Users whose first paid subscription was created since `weekStart`. */
  paidConversionsThisWeek: number;
  /** Paid (non-admin-grant) subscriptions in ACTIVE or PAST_DUE. */
  activeSubscriptions: number;
  trialingSubscriptions: number;
  mrr: {
    currency: 'BRL';
    /** Monthly recurring revenue in BRL cents. */
    amountCents: number;
    /**
     * Active subscriptions left out because their plan has no BRL price
     * for the billing period (no FX conversion is attempted).
     */
    excludedSubscriptions: number;
  };
  topCourses: TopCourseView[];
}

export interface DropOffLessonView {
  lessonId: string;
  title: string;
  courseSlug: string;
  /** Distinct learners who opened the lesson in the window. */
  started: number;
  /** Of those, how many completed it. */
  completed: number;
  /** 1 − completed / started. */
  dropOffRate: number;
}

export interface TeacherDashboardKpis {
  enrollmentsToday: number;
  enrollmentsTodayByCourse: {
    courseId: string;
    title: string;
    count: number;
  }[];
  topDropOffLessons: DropOffLessonView[];
  /** Missing + outdated translation fields across own content. */
  pendingTranslations: number;
}

export interface DashboardResponse {
  scope: 'admin' | 'teacher';
  generatedAt: string;
  /** UTC Monday 00:00 that "this week" counts from. */
  weekStart: string;
  admin: AdminDashboardKpis | null;
  teacher: TeacherDashboardKpis | null;
  recentActivity: AuditEntryView[];
}

// ─── Search ────────────────────────────────────────────────────────────────

export type SearchHitType = 'course' | 'lesson' | 'user' | 'item' | 'badge';

export interface SearchHit {
  type: SearchHitType;
  id: string;
  title: string;
  /** Slug, email or parent course — the second line in the palette. */
  subtitle: string | null;
  /** For lessons: the parent course slug (deep link context). */
  courseSlug?: string | null;
}

export interface SearchResponse {
  q: string;
  courses: SearchHit[];
  lessons: SearchHit[];
  users: SearchHit[];
  items: SearchHit[];
  badges: SearchHit[];
}

// ─── Audit ─────────────────────────────────────────────────────────────────

export class AuditQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  actorId?: string;

  /** Prefix match: `user.` lists every user action. */
  @IsOptional()
  @IsString()
  @Length(1, 80)
  action?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  entityType?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  entityId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

// ─── Leagues ───────────────────────────────────────────────────────────────

export type LeagueTierName =
  | 'BRONZE'
  | 'SILVER'
  | 'GOLD'
  | 'PLATINUM'
  | 'DIAMOND';

export interface LeagueTierSnapshot {
  tier: LeagueTierName;
  leagues: number;
  members: number;
  p50WeeklyXp: number;
  p95WeeklyXp: number;
}

export interface LeagueSummaryView {
  id: string;
  tier: LeagueTierName;
  cohortKey: string;
  members: number;
  topWeeklyXp: number;
}

export interface LeagueRulesView {
  /** Code constants from @codify/domain (not admin-editable). */
  cohortCapacity: number;
  promoteCount: number;
  demoteCount: number;
  minCohortForDemotion: number;
  /** GamificationConfig `league.promotionReward` / `league.rank1Reward`. */
  promotionReward: { xp: number; coins: number; freeze: number };
  rank1Reward: { xp: number; coins: number };
}

export interface LeagueSnapshotResponse {
  weekStart: string;
  tiers: LeagueTierSnapshot[];
  leagues: LeagueSummaryView[];
  rules: LeagueRulesView;
}

export interface LeagueMemberAdminView {
  rank: number;
  userId: string;
  displayName: string;
  weeklyXp: number;
  zone: 'promote' | 'demote' | 'stay';
  finalRank: number | null;
  promoted: boolean | null;
  demoted: boolean | null;
}

export interface LeagueDetailResponse {
  id: string;
  tier: LeagueTierName;
  weekStart: string;
  cohortKey: string;
  promoteZone: number;
  demoteZone: number;
  members: LeagueMemberAdminView[];
}

export class LeagueSnapshotQueryDto {
  /** Any date inside the wanted week (defaults to the current week). */
  @IsOptional()
  @IsISO8601()
  weekStart?: string;
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

export interface GrantItemResponse {
  entry: UserInventoryEntry;
  /** True when the user already owned the item (nothing was written). */
  alreadyOwned: boolean;
}

export class GrantItemDto {
  @IsString()
  @Length(1, 64)
  itemId!: string;

  @IsString()
  @Length(3, 300)
  reason!: string;
}

export type LedgerType = 'coins' | 'xp';

export interface LedgerEntryView {
  id: string;
  createdAt: string;
  delta: number;
  balanceAfter: number;
  source: string;
  multiplier: string | null;
  refType: string | null;
  refId: string | null;
}

export interface LedgerPage extends Page<LedgerEntryView> {
  type: LedgerType;
  /** Current balance (coins) or total XP from the journal. */
  balance: number;
}

export class LedgerQueryDto {
  @IsOptional()
  @IsIn(['coins', 'xp'])
  type?: LedgerType;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

// ─── Badge test ────────────────────────────────────────────────────────────

export class BadgeTestDto {
  @IsString()
  @Length(1, 64)
  userId!: string;
}

export interface BadgeClauseResult {
  /** `event` name or `metric` key the clause reads. */
  kind: 'event' | 'metric';
  key: string;
  /** The predicate, e.g. `{ gte: 10 }`. */
  predicate: Record<string, number>;
  value: number;
  passed: boolean;
}

export interface BadgeTestResponse {
  badgeId: string;
  userId: string;
  /** True when the rule passes for the user right now (nothing is awarded). */
  wouldUnlock: boolean;
  alreadyEarned: boolean;
  awardedAt: string | null;
  badgeActive: boolean;
  mode: 'all' | 'any' | 'none';
  clauses: BadgeClauseResult[];
  events: Record<string, number>;
  metrics: Record<string, number>;
}

// ─── Item categories ───────────────────────────────────────────────────────

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

export interface ItemCategoryAdminView {
  slug: string;
  name: string;
  sortOrder: number;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export class CreateItemCategoryAdminDto {
  @IsString()
  @Length(2, 60)
  @Matches(SLUG)
  slug!: string;

  @IsString()
  @Length(1, 80)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

/** Slug is the primary key items reference, so it is immutable. */
export class UpdateItemCategoryAdminDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}
