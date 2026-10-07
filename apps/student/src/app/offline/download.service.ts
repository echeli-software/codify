import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import {
  CoursesClient,
  EnrollmentsClient,
  LessonsClient,
  TranslationsClient,
  toProblemDetails,
  type ContentLocale,
  type CourseDetail,
  type LessonOfflineBundle,
  type TranslatableEntityType,
} from '@codify/api-client';
import { I18nService } from '@codify/i18n';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import {
  AssetCacheService,
  CONTENT_ASSET_CACHE,
} from './asset-cache.service.js';
import { idbAvailable, idbStores, tx } from './db.js';
import { NetworkStatusService } from './network-status.service.js';

const {
  STORE_DOWNLOADS,
  STORE_DL_LESSONS,
  STORE_ASSETS,
  STORE_DL_TRANSLATIONS,
} = idbStores;
const PREFS_KEY = 'codify.downloads.prefs';
const MB = 1024 * 1024;
export const DEFAULT_BUDGET_BYTES = 1024 * MB; // 1 GB (docs/16 §5)
/** Re-check a course for content updates at most this often. */
const UPDATE_CHECK_TTL_MS = 30 * 60_000;
/** Per-lesson fetch retries before a download is marked failed. */
const ITEM_RETRIES = 2;
/** IDs per `GET /translations` request (server cap is 100). */
const TRANSLATION_BATCH = 100;

export type DownloadStatus = 'downloading' | 'complete' | 'partial' | 'paused';
export type DownloadScope = 'course' | 'module' | 'lesson' | 'auto';

export interface DownloadRecord {
  courseId: string;
  courseSlug: string;
  title: string;
  /** Lessons stored on device. */
  lessonCount: number;
  /** Bytes on device: lesson JSON + images + translations. */
  totalBytes: number;
  status: DownloadStatus;
  downloadedAt: number;
  lastReadAt: number;
  /** Course.updatedAt at download time. */
  sourceUpdatedAt: string;
  /** Lessons in the course (for "12 of 14"). */
  totalLessons?: number;
  /** What the user asked for — a module/lesson download stays "partial". */
  scope?: DownloadScope;
  /** Lessons the user can't access (402) — skipped, not failed. */
  lockedLessonIds?: string[];
  /** Image URLs stored in the content cache for this course. */
  imageUrls?: string[];
  imageBytes?: number;
  /** Set by `checkForUpdates`: some lesson's `updatedAt` moved on. */
  updateAvailable?: boolean;
  changedLessonIds?: string[];
  checkedAt?: number;
  /** Last successful download/update. */
  updatedAt?: number;
  /** Locale whose ContentTranslation rows were prefetched. */
  locale?: string;
}

export interface DownloadedLesson {
  lessonId: string;
  courseId: string;
  title: string;
  type: string;
  isFree: boolean;
  baseXp: number;
  baseCoins: number;
  /** LessonDoc with quiz answers stripped (from the offline bundle). */
  contentJson: unknown;
  sizeBytes: number;
  moduleId?: string;
  order?: number;
  estimatedMinutes?: number;
  updatedAt?: string;
  /** For instant offline quiz feedback via `checkQuizAnswerHash`. */
  quizAnswerHashes?: LessonOfflineBundle['quizAnswerHashes'];
  imageSrcs?: string[];
}

/** Back-compat progress shape (course detail page). */
export interface DownloadProgress {
  courseId: string;
  current: number;
  total: number;
  status: DownloadStatus | 'cancelled';
}

export type CourseDownloadState =
  | 'none'
  | 'downloading'
  | 'paused'
  | 'waitingForWifi'
  | 'needsSpace'
  | 'error'
  | 'partial'
  | 'complete';

/** Everything a UI needs about one course's download (`status(courseId)`). */
export interface CourseDownloadStatus {
  courseId: string;
  state: CourseDownloadState;
  current: number;
  total: number;
  /** 0–100 while a job runs. */
  pct: number;
  bytes: number;
  lessonCount: number;
  updateAvailable: boolean;
  changedLessons: number;
  /** Epoch ms of the last download/update, or null. */
  lastUpdatedAt: number | null;
}

export interface DownloadPrefs {
  wifiOnly: boolean;
  autoUpdate: boolean;
  /** Opt-in: download free + first paid module of enrolled courses. */
  autoDownloadEnrolled: boolean;
  budgetBytes: number;
}

/** Pending "make room?" question shown by `<cdf-storage-prompt>`. */
export interface SpaceRequest {
  /** Course being downloaded (null when the budget was lowered). */
  courseId: string | null;
  title: string | null;
  /** Bytes over budget. */
  overBytes: number;
  /** LRU candidates that would be removed (oldest read first). */
  evict: DownloadRecord[];
  /** True when evicting every candidate still isn't enough. */
  insufficient: boolean;
}

interface Job {
  courseId: string;
  queue: string[];
  done: number;
  total: number;
  state:
    | 'running'
    | 'paused'
    | 'waitingForWifi'
    | 'needsSpace'
    | 'error'
    | 'cancelled';
  scope: DownloadScope;
  startedAt: number;
}

interface TranslationRow {
  key: string;
  courseId: string;
  locale: string;
  entityType: string;
  entityId: string;
  fields: Record<string, string>;
}

const DEFAULT_PREFS: DownloadPrefs = {
  wifiOnly: true,
  autoUpdate: true,
  autoDownloadEnrolled: false,
  budgetBytes: DEFAULT_BUDGET_BYTES,
};

/** Byte size of a JSON-serializable value. */
export function jsonBytes(value: unknown): number {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    try {
      return JSON.stringify(value).length;
    } catch {
      return 0;
    }
  }
}

/**
 * LRU eviction plan: least-recently-read first, never `keep`, until at
 * least `overBytes` would be freed. Pure — unit-tested.
 */
export function planEviction(
  records: readonly DownloadRecord[],
  overBytes: number,
  keep: string | null,
): { evict: DownloadRecord[]; freed: number; insufficient: boolean } {
  const evict: DownloadRecord[] = [];
  let freed = 0;
  const candidates = records
    .filter((r) => r.courseId !== keep)
    .sort((a, b) => a.lastReadAt - b.lastReadAt);
  for (const c of candidates) {
    if (freed >= overBytes) break;
    evict.push(c);
    freed += c.totalBytes;
  }
  return { evict, freed, insufficient: freed < overBytes };
}

/**
 * Explicit-download engine + offline content cache (docs/16 §5–§9,
 * roadmap Phase 8b).
 *
 *   - Course / module / lesson downloads store the offline bundle (LessonDoc
 *     without quiz answers + answer hashes), lesson metadata, inline images
 *     (Cache Storage) and the current locale's ContentTranslation rows.
 *   - Downloads report progress and can be paused / resumed / cancelled;
 *     Wi-Fi-only mode pauses them on cellular and resumes on Wi-Fi.
 *   - A storage budget is enforced by asking first (`spaceRequest`) and only
 *     then evicting least-recently-read courses — never silently.
 *   - `checkForUpdates` compares `lessonVersions`; `updateCourse` re-fetches
 *     only lessons whose `updatedAt` changed; auto-update runs on Wi-Fi.
 */
@Injectable({ providedIn: 'root' })
export class DownloadService {
  private readonly coursesClient = inject(CoursesClient);
  private readonly lessonsClient = inject(LessonsClient);
  private readonly enrollments = inject(EnrollmentsClient);
  private readonly translations = inject(TranslationsClient);
  private readonly i18n = inject(I18nService);
  private readonly network = inject(NetworkStatusService);
  private readonly assets = inject(AssetCacheService);
  private readonly telemetry = inject(TelemetryService);

  /** All download records (reactive). */
  readonly downloads = signal<DownloadRecord[]>([]);
  readonly prefs = signal<DownloadPrefs>(this.readPrefs());
  /** Device storage estimate (`navigator.storage.estimate`), when available. */
  readonly storageEstimate = signal<{ usage: number; quota: number } | null>(
    null,
  );
  /** Non-null while the app is asking the user to make room. */
  readonly spaceRequest = signal<SpaceRequest | null>(null);

  private readonly jobs = signal<Record<string, Job>>({});
  private spaceResolver: ((accept: boolean) => void) | null = null;
  private hydrateP: Promise<void> | null = null;
  private readonly statusCache = new Map<
    string,
    Signal<CourseDownloadStatus>
  >();

  /** Total bytes used across all downloads. */
  readonly totalBytes = computed(() =>
    this.downloads().reduce((s, d) => s + d.totalBytes, 0),
  );

  /** In-flight progress per course id (back-compat). */
  readonly progress = computed<Record<string, DownloadProgress>>(() => {
    const out: Record<string, DownloadProgress> = {};
    for (const j of Object.values(this.jobs())) {
      out[j.courseId] = {
        courseId: j.courseId,
        current: j.done,
        total: j.total,
        status:
          j.state === 'cancelled'
            ? 'cancelled'
            : j.state === 'running'
              ? 'downloading'
              : 'paused',
      };
    }
    return out;
  });

  /** Network allowed for downloads right now (online, and Wi-Fi if required). */
  readonly canDownloadNow = computed(
    () =>
      this.network.online() &&
      !(this.prefs().wifiOnly && this.network.metered()),
  );

  constructor() {
    // Wi-Fi-only: pause on cellular, resume on Wi-Fi (docs/16 §5).
    effect(() => {
      const ok = this.canDownloadNow();
      untracked(() => {
        for (const job of Object.values(this.jobs())) {
          if (ok && job.state === 'waitingForWifi') {
            this.patchJob(job.courseId, { state: 'running' });
            void this.runJob(job.courseId);
          } else if (!ok && job.state === 'running') {
            this.patchJob(job.courseId, { state: 'waitingForWifi' });
            this.telemetry.track('download_paused', {
              courseId: job.courseId,
              reason: this.network.online() ? 'cellular' : 'offline',
            });
          }
        }
        if (ok) void this.backgroundMaintenance();
      });
    });
  }

  // ─── Queries ────────────────────────────────────────────────────────────

  /** Load records from IndexedDB into the reactive signal (once). */
  hydrate(): Promise<void> {
    if (!this.hydrateP) {
      this.hydrateP = (async () => {
        if (!idbAvailable()) return;
        try {
          this.downloads.set(await this.allRecords());
        } catch {
          /* storage blocked — downloads unavailable */
        }
        void this.refreshEstimate();
      })();
    }
    return this.hydrateP;
  }

  isDownloaded(courseId: string): boolean {
    return this.downloads().some(
      (d) => d.courseId === courseId && d.status === 'complete',
    );
  }

  recordFor(courseId: string): DownloadRecord | undefined {
    return this.downloads().find((d) => d.courseId === courseId);
  }

  /** True when the course has updated lessons (or the cached source predates `liveUpdatedAt`). */
  updateAvailable(courseId: string, liveUpdatedAt?: string): boolean {
    const rec = this.recordFor(courseId);
    if (!rec) return false;
    if (rec.updateAvailable) return true;
    if (!liveUpdatedAt) return false;
    return (
      new Date(liveUpdatedAt).getTime() >
      new Date(rec.sourceUpdatedAt).getTime()
    );
  }

  /** Reactive per-course status (state, progress, size, update flag). */
  status(courseId: string): Signal<CourseDownloadStatus> {
    let s = this.statusCache.get(courseId);
    if (!s) {
      s = computed(() => this.computeStatus(courseId));
      this.statusCache.set(courseId, s);
    }
    return s;
  }

  /** Downloaded lesson (offline read). */
  async getDownloadedLesson(
    lessonId: string,
  ): Promise<DownloadedLesson | null> {
    if (!idbAvailable()) return null;
    try {
      const l = await tx<DownloadedLesson | undefined>(
        STORE_DL_LESSONS,
        'readonly',
        (s) => s.get(lessonId),
      );
      return l ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Lesson content + quiz answer hashes for offline reading/grading: the
   * downloaded copy when present, else (online) a fresh
   * `LessonsClient.offlineBundle` — not persisted. Null when neither.
   */
  async getLessonBundle(lessonId: string): Promise<DownloadedLesson | null> {
    const cached = await this.getDownloadedLesson(lessonId);
    if (cached) return cached;
    if (!this.network.online()) return null;
    try {
      const bundle = await this.lessonsClient.offlineBundle(lessonId);
      return toDownloadedLesson(bundle, bundle.lesson.courseId, 0);
    } catch {
      return null;
    }
  }

  /** Downloaded translations for an offline `CONTENT_TRANSLATION_SOURCE`. */
  async getTranslations(
    entityType: string,
    ids: readonly string[],
    locale: string,
  ): Promise<Record<string, Record<string, string>>> {
    const out: Record<string, Record<string, string>> = {};
    if (!idbAvailable()) return out;
    for (const id of ids) {
      try {
        const row = await tx<TranslationRow | undefined>(
          STORE_DL_TRANSLATIONS,
          'readonly',
          (s) => s.get(`${locale}|${entityType}|${id}`),
        );
        if (row) out[id] = row.fields;
      } catch {
        /* ignore */
      }
    }
    return out;
  }

  // ─── Downloads ──────────────────────────────────────────────────────────

  /**
   * Download (or complete) a whole course for offline reading. Resolves
   * with the record once the job ends; null when it was paused (Wi-Fi /
   * space / user), cancelled, or could not start.
   */
  async downloadCourse(
    idOrSlug: string,
    opts: { scope?: DownloadScope; lessonIds?: string[] } = {},
  ): Promise<DownloadRecord | null> {
    await this.hydrate();
    if (!this.network.online()) return null;
    const detail = await this.coursesClient.detail(idOrSlug);
    const all = detail.modules.flatMap((m) => m.lessons.map((l) => l.id));
    const wanted = opts.lessonIds ?? all;
    const scope = opts.scope ?? (opts.lessonIds ? 'module' : 'course');
    return this.startJob(detail, wanted, scope);
  }

  /** Download one module of a course. */
  downloadModule(
    courseId: string,
    moduleId: string,
  ): Promise<DownloadRecord | null> {
    return (async () => {
      await this.hydrate();
      if (!this.network.online()) return null;
      const detail = await this.coursesClient.detail(courseId);
      const mod = detail.modules.find((m) => m.id === moduleId);
      if (!mod) return null;
      return this.startJob(
        detail,
        mod.lessons.map((l) => l.id),
        'module',
      );
    })();
  }

  /** Download a single lesson (and its course metadata). */
  async downloadLesson(lessonId: string): Promise<DownloadRecord | null> {
    await this.hydrate();
    if (!this.network.online()) return null;
    const bundle = await this.lessonsClient.offlineBundle(lessonId);
    const detail = await this.coursesClient.detail(bundle.lesson.courseId);
    return this.startJob(detail, [lessonId], 'lesson');
  }

  /** Pause an in-progress download after the current lesson. */
  pause(courseId: string): void {
    const job = this.jobs()[courseId];
    if (!job || job.state === 'cancelled') return;
    this.patchJob(courseId, { state: 'paused' });
    this.telemetry.track('download_paused', { courseId, reason: 'user' });
  }

  /** Resume a paused / partial download. */
  async resume(courseId: string): Promise<DownloadRecord | null> {
    await this.hydrate();
    const job = this.jobs()[courseId];
    if (job && job.state !== 'cancelled') {
      if (job.state === 'running') return null;
      this.patchJob(courseId, {
        state: this.canDownloadNow() ? 'running' : 'waitingForWifi',
      });
      return this.canDownloadNow() ? this.runJob(courseId) : null;
    }
    const rec = this.recordFor(courseId);
    if (!rec || !this.network.online()) return null;
    const detail = await this.coursesClient.detail(courseId);
    const stored = new Set(
      (await this.lessonsByCourse(courseId)).map((l) => l.lessonId),
    );
    const locked = new Set(rec.lockedLessonIds ?? []);
    const missing = detail.modules
      .flatMap((m) => m.lessons.map((l) => l.id))
      .filter((id) => !stored.has(id) && !locked.has(id));
    return this.startJob(detail, missing, rec.scope ?? 'course');
  }

  /** Cancel an in-progress download and drop what it stored. */
  cancel(courseId: string): void {
    const job = this.jobs()[courseId];
    if (!job) return;
    const wasRunning = job.state === 'running';
    this.patchJob(courseId, { state: 'cancelled' });
    if (!wasRunning) void this.finishCancel(courseId);
  }

  /**
   * Re-fetch only the lessons whose `updatedAt` changed (plus new lessons
   * for whole-course downloads; removed lessons are deleted).
   */
  async updateCourse(courseId: string): Promise<DownloadRecord | null> {
    await this.hydrate();
    const rec = this.recordFor(courseId);
    if (!rec || !this.network.online()) return null;
    const [versions, detail, local] = await Promise.all([
      this.lessonsClient.lessonVersions(courseId),
      this.coursesClient.detail(courseId),
      this.lessonsByCourse(courseId),
    ]);
    const localById = new Map(local.map((l) => [l.lessonId, l]));
    const live = new Set(versions.map((v) => v.lessonId));
    const wholeCourse =
      (rec.scope ?? 'course') === 'course' || rec.scope === 'auto';
    const locked = new Set(rec.lockedLessonIds ?? []);
    const changed = versions
      .filter((v) => {
        const mine = localById.get(v.lessonId);
        if (mine) return mine.updatedAt !== v.updatedAt;
        return wholeCourse && rec.scope !== 'auto' && !locked.has(v.lessonId);
      })
      .map((v) => v.lessonId);
    const removed = local.filter((l) => !live.has(l.lessonId));
    for (const l of removed) await this.deleteLesson(l.lessonId);
    this.telemetry.track('download_update_started', {
      courseId,
      changed: changed.length,
      removed: removed.length,
    });
    if (changed.length === 0) {
      await this.putRecord({
        ...(this.recordFor(courseId) ?? rec),
        updateAvailable: false,
        changedLessonIds: [],
        sourceUpdatedAt: detail.updatedAt,
        checkedAt: Date.now(),
        updatedAt: Date.now(),
      });
      await this.recount(courseId);
      return this.recordFor(courseId) ?? null;
    }
    return this.startJob(detail, changed, rec.scope ?? 'course', true);
  }

  /**
   * Compare every downloaded course against `lessonVersions` and flag
   * `updateAvailable`. Cheap; throttled per course unless `force`.
   */
  async checkForUpdates(
    opts: { courseId?: string; force?: boolean } = {},
  ): Promise<void> {
    await this.hydrate();
    if (!this.network.online()) return;
    const targets = this.downloads().filter(
      (r) =>
        (!opts.courseId || r.courseId === opts.courseId) &&
        !this.jobs()[r.courseId] &&
        (opts.force ||
          !r.checkedAt ||
          Date.now() - r.checkedAt > UPDATE_CHECK_TTL_MS),
    );
    for (const rec of targets) {
      try {
        const versions = await this.lessonsClient.lessonVersions(rec.courseId);
        const local = new Map(
          (await this.lessonsByCourse(rec.courseId)).map((l) => [
            l.lessonId,
            l.updatedAt,
          ]),
        );
        const changed = versions
          .filter(
            (v) =>
              local.has(v.lessonId) && local.get(v.lessonId) !== v.updatedAt,
          )
          .map((v) => v.lessonId);
        const added =
          (rec.scope ?? 'course') === 'course'
            ? versions.filter(
                (v) =>
                  !local.has(v.lessonId) &&
                  !(rec.lockedLessonIds ?? []).includes(v.lessonId),
              ).length
            : 0;
        const live = new Set(versions.map((v) => v.lessonId));
        const removed = [...local.keys()].filter((id) => !live.has(id)).length;
        const updateAvailable = changed.length + added + removed > 0;
        await this.putRecord({
          ...(this.recordFor(rec.courseId) ?? rec),
          updateAvailable,
          changedLessonIds: changed,
          checkedAt: Date.now(),
        });
        if (updateAvailable && !rec.updateAvailable) {
          this.telemetry.track('download_update_available', {
            courseId: rec.courseId,
            changed: changed.length + added + removed,
          });
        }
      } catch {
        /* try again next time */
      }
    }
  }

  /**
   * Auto-download (opt-in pref): free lessons + the first paid module of
   * every enrolled course not already downloaded (docs/16 §5).
   */
  async syncEnrolledDownloads(): Promise<number> {
    await this.hydrate();
    if (!this.prefs().autoDownloadEnrolled || !this.canDownloadNow()) return 0;
    let started = 0;
    try {
      const mine = await this.enrollments.mine();
      for (const e of mine) {
        if (this.recordFor(e.courseId) || this.jobs()[e.courseId]) continue;
        const detail = await this.coursesClient.detail(e.courseId);
        const wanted = autoDownloadSelection(detail);
        if (wanted.length === 0) continue;
        started += 1;
        void this.startJob(detail, wanted, 'auto').catch(() => null);
      }
    } catch {
      /* next sign-in / toggle retries */
    }
    return started;
  }

  /** Call after the user enrolls — honours the auto-download pref. */
  onEnrolled(courseId: string): void {
    if (!this.prefs().autoDownloadEnrolled) return;
    void (async () => {
      try {
        await this.hydrate();
        if (this.recordFor(courseId) || !this.canDownloadNow()) return;
        const detail = await this.coursesClient.detail(courseId);
        await this.startJob(detail, autoDownloadSelection(detail), 'auto');
      } catch {
        /* ignore — the next syncEnrolledDownloads retries */
      }
    })();
  }

  async removeCourse(courseId: string): Promise<void> {
    await this.hydrate();
    const rec = this.recordFor(courseId);
    const lessons = await this.lessonsByCourse(courseId).catch(() => []);
    for (const l of lessons) await this.deleteLesson(l.lessonId);
    await this.deleteTranslations(courseId);
    if (rec?.imageUrls?.length) {
      const stillUsed = new Set(
        this.downloads()
          .filter((r) => r.courseId !== courseId)
          .flatMap((r) => r.imageUrls ?? []),
      );
      await this.assets.removeUrls(
        rec.imageUrls.filter((u) => !stillUsed.has(u)),
        CONTENT_ASSET_CACHE,
      );
    }
    if (idbAvailable()) {
      await tx(STORE_DOWNLOADS, 'readwrite', (s) => s.delete(courseId));
    }
    this.dropJob(courseId);
    await this.refresh();
    void this.refreshEstimate();
  }

  async removeAll(): Promise<void> {
    for (const rec of [...this.downloads()])
      await this.removeCourse(rec.courseId);
    await this.assets.clear(CONTENT_ASSET_CACHE);
  }

  /** Touch a course's lastReadAt so it survives LRU eviction. */
  async markRead(courseId: string): Promise<void> {
    const rec = this.recordFor(courseId);
    if (!rec) return;
    await this.putRecord({ ...rec, lastReadAt: Date.now() });
  }

  // ─── Asset prefetch (offline dressing room) ──────────────────────────────

  /**
   * Cache the avatar + inventory bundle so the dressing room renders offline
   * (docs/16 §6: a signed-in user's avatar must always render offline).
   */
  async prefetchAssets(bundle: {
    avatar: unknown;
    inventory: unknown;
  }): Promise<void> {
    if (!idbAvailable()) return;
    await tx(STORE_ASSETS, 'readwrite', (s) =>
      s.put({ ...bundle, cachedAt: Date.now() }, 'current'),
    );
  }

  async getCachedAssets(): Promise<{
    avatar: unknown;
    inventory: unknown;
  } | null> {
    if (!idbAvailable()) return null;
    const v = await tx<{ avatar: unknown; inventory: unknown } | undefined>(
      STORE_ASSETS,
      'readonly',
      (s) => s.get('current'),
    );
    return v ?? null;
  }

  async clearCachedAssets(): Promise<void> {
    if (!idbAvailable()) return;
    await tx(STORE_ASSETS, 'readwrite', (s) => s.clear());
  }

  // ─── Prefs / budget ─────────────────────────────────────────────────────

  setPrefs(patch: Partial<DownloadPrefs>): void {
    const prev = this.prefs();
    const next = { ...prev, ...patch };
    this.prefs.set(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      /* private mode — ignore */
    }
    this.telemetry.track('download_prefs_changed', { ...patch });
    if (patch.budgetBytes != null && patch.budgetBytes < prev.budgetBytes) {
      const over = this.totalBytes() - next.budgetBytes;
      if (over > 0) void this.askForSpace(null, null, over);
    }
    if (patch.autoDownloadEnrolled && !prev.autoDownloadEnrolled) {
      void this.syncEnrolledDownloads();
    }
  }

  /** Answer the pending `spaceRequest` (from `<cdf-storage-prompt>`). */
  resolveSpaceRequest(accept: boolean): void {
    const resolve = this.spaceResolver;
    this.spaceResolver = null;
    this.spaceRequest.set(null);
    resolve?.(accept);
  }

  async refreshEstimate(): Promise<void> {
    try {
      const est = await navigator.storage?.estimate?.();
      if (est)
        this.storageEstimate.set({
          usage: est.usage ?? 0,
          quota: est.quota ?? 0,
        });
    } catch {
      /* unsupported */
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private computeStatus(courseId: string): CourseDownloadStatus {
    const rec = this.downloads().find((d) => d.courseId === courseId);
    const job = this.jobs()[courseId];
    let state: CourseDownloadState = 'none';
    if (job && job.state !== 'cancelled') {
      state = job.state === 'running' ? 'downloading' : job.state;
    } else if (rec) {
      state =
        rec.status === 'complete'
          ? 'complete'
          : rec.status === 'downloading'
            ? 'paused'
            : 'partial';
    }
    const current = job?.done ?? 0;
    const total = job?.total ?? 0;
    return {
      courseId,
      state,
      current,
      total,
      pct: total > 0 ? Math.round((current / total) * 100) : 0,
      bytes: rec?.totalBytes ?? 0,
      lessonCount: rec?.lessonCount ?? 0,
      updateAvailable: rec?.updateAvailable === true,
      changedLessons: rec?.changedLessonIds?.length ?? 0,
      lastUpdatedAt: rec ? (rec.updatedAt ?? rec.downloadedAt) : null,
    };
  }

  private async startJob(
    detail: CourseDetail,
    lessonIds: string[],
    scope: DownloadScope,
    isUpdate = false,
  ): Promise<DownloadRecord | null> {
    const courseId = detail.id;
    const existingJob = this.jobs()[courseId];
    if (existingJob && existingJob.state === 'running') {
      // Merge into the running job rather than starting a second loop.
      const merged = [...new Set([...existingJob.queue, ...lessonIds])];
      this.patchJob(courseId, {
        queue: merged,
        total: existingJob.done + merged.length,
      });
      return null;
    }
    const prev = this.recordFor(courseId);
    const totalLessons = detail.modules.reduce(
      (n, m) => n + m.lessons.length,
      0,
    );
    const record: DownloadRecord = {
      courseId,
      courseSlug: detail.slug,
      title: detail.title,
      lessonCount: prev?.lessonCount ?? 0,
      totalBytes: prev?.totalBytes ?? 0,
      status: 'downloading',
      downloadedAt: prev?.downloadedAt ?? Date.now(),
      lastReadAt: Date.now(),
      sourceUpdatedAt: detail.updatedAt,
      totalLessons,
      scope: mergeScope(prev?.scope, scope),
      lockedLessonIds: prev?.lockedLessonIds ?? [],
      imageUrls: prev?.imageUrls ?? [],
      imageBytes: prev?.imageBytes ?? 0,
      updateAvailable: prev?.updateAvailable ?? false,
      changedLessonIds: prev?.changedLessonIds ?? [],
      checkedAt: prev?.checkedAt,
      updatedAt: prev?.updatedAt,
      locale: this.i18n.currentLocale(),
    };
    await this.putRecord(record);
    this.jobs.update((m) => ({
      ...m,
      [courseId]: {
        courseId,
        queue: [...new Set(lessonIds)],
        done: 0,
        total: new Set(lessonIds).size,
        state: this.canDownloadNow() ? 'running' : 'waitingForWifi',
        scope,
        startedAt: Date.now(),
      },
    }));
    this.telemetry.track(
      isUpdate ? 'download_update_started' : 'download_started',
      {
        courseId,
        scope,
        lessons: lessonIds.length,
        networkType: this.network.connectionType(),
      },
    );
    void this.requestPersistence();

    // Budget pre-check: already at/over the cap → ask before fetching anything.
    const over = this.totalBytes() - this.prefs().budgetBytes;
    if (over >= 0) {
      this.patchJob(courseId, { state: 'needsSpace' });
      const ok = await this.askForSpace(
        courseId,
        detail.title,
        Math.max(over, 1),
      );
      if (!ok) return null;
      this.patchJob(courseId, {
        state: this.canDownloadNow() ? 'running' : 'waitingForWifi',
      });
    }
    if (this.jobs()[courseId]?.state !== 'running') return null;
    return this.runJob(courseId);
  }

  private async runJob(courseId: string): Promise<DownloadRecord | null> {
    const fetchedLessons: string[] = [];
    let failed: unknown = null;
    while (true) {
      const job = this.jobs()[courseId];
      if (!job) return null;
      if (job.state === 'cancelled') {
        await this.finishCancel(courseId);
        return null;
      }
      if (job.state !== 'running') break;
      if (!this.canDownloadNow()) {
        this.patchJob(courseId, { state: 'waitingForWifi' });
        break;
      }
      const lessonId = job.queue[0];
      if (!lessonId) break;
      try {
        const added = await this.fetchLessonWithRetry(courseId, lessonId);
        if (added === 'locked') {
          const rec = this.recordFor(courseId);
          if (rec) {
            await this.putRecord({
              ...rec,
              lockedLessonIds: [
                ...new Set([...(rec.lockedLessonIds ?? []), lessonId]),
              ],
            });
          }
        } else {
          fetchedLessons.push(lessonId);
        }
      } catch (err) {
        failed = err;
        this.patchJob(courseId, { state: 'error' });
        break;
      }
      const cur = this.jobs()[courseId];
      if (!cur) return null;
      this.patchJob(courseId, {
        queue: cur.queue.slice(1),
        done: cur.done + 1,
      });
      await this.recount(courseId);

      // Over budget mid-download → pause and ask (docs/16 §12).
      const over = this.totalBytes() - this.prefs().budgetBytes;
      if (over > 0 && this.jobs()[courseId]?.state === 'running') {
        this.patchJob(courseId, { state: 'needsSpace' });
        const title = this.recordFor(courseId)?.title ?? null;
        const ok = await this.askForSpace(courseId, title, over);
        if (!ok) break;
        this.patchJob(courseId, { state: 'running' });
      }
    }

    const job = this.jobs()[courseId];
    if (fetchedLessons.length > 0)
      await this.prefetchTranslations(courseId, fetchedLessons);
    await this.recount(courseId);
    if (job && job.queue.length === 0 && job.state === 'running') {
      return this.finishJob(courseId, job);
    }
    if (failed) {
      this.telemetry.track('download_failed', {
        courseId,
        reason: describeError(failed),
        networkType: this.network.connectionType(),
      });
    }
    const rec = this.recordFor(courseId);
    if (rec)
      await this.putRecord({
        ...rec,
        status: rec.lessonCount > 0 ? 'partial' : 'downloading',
      });
    return null;
  }

  private async finishJob(
    courseId: string,
    job: Job,
  ): Promise<DownloadRecord | null> {
    this.dropJob(courseId);
    const rec = this.recordFor(courseId);
    if (!rec) return null;
    const locked = rec.lockedLessonIds?.length ?? 0;
    const complete =
      (rec.scope ?? 'course') === 'course' &&
      rec.totalLessons != null &&
      rec.lessonCount + locked >= rec.totalLessons;
    const final: DownloadRecord = {
      ...rec,
      status: complete ? 'complete' : 'partial',
      updateAvailable: false,
      changedLessonIds: [],
      checkedAt: Date.now(),
      updatedAt: Date.now(),
    };
    await this.putRecord(final);
    this.telemetry.track('download_completed', {
      courseId,
      scope: job.scope,
      lessons: job.total,
      bytes: final.totalBytes,
      durationMs: Date.now() - job.startedAt,
      networkType: this.network.connectionType(),
    });
    void this.refreshEstimate();
    return final;
  }

  private async finishCancel(courseId: string): Promise<void> {
    this.telemetry.track('download_cancelled', { courseId });
    await this.removeCourse(courseId);
  }

  /** Fetch + store one lesson; 'locked' for a 402 (no access). */
  private async fetchLessonWithRetry(
    courseId: string,
    lessonId: string,
  ): Promise<'ok' | 'locked'> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= ITEM_RETRIES; attempt += 1) {
      try {
        const bundle = await this.lessonsClient.offlineBundle(lessonId);
        const images = await this.assets.cacheUrls(
          bundle.imageSrcs ?? [],
          CONTENT_ASSET_CACHE,
        );
        const lesson = toDownloadedLesson(bundle, courseId, images.bytes);
        if (idbAvailable()) {
          await tx(STORE_DL_LESSONS, 'readwrite', (s) => s.put(lesson));
        }
        const rec = this.recordFor(courseId);
        if (rec && images.cached.length > 0) {
          const urls = new Set(rec.imageUrls ?? []);
          const fresh = images.cached.filter((u) => !urls.has(u));
          await this.putRecord({
            ...rec,
            imageUrls: [...urls, ...fresh],
          });
        }
        return 'ok';
      } catch (err) {
        const status = toProblemDetails(err).status;
        if (status === 402 || status === 403) return 'locked';
        if (
          status === 404 ||
          (status >= 400 && status < 500 && status !== 408 && status !== 429)
        ) {
          throw err;
        }
        lastErr = err;
        if (attempt < ITEM_RETRIES) await sleep(1000 * 2 ** attempt);
      }
    }
    throw lastErr;
  }

  /** Current locale's ContentTranslation rows for the course's entities. */
  private async prefetchTranslations(
    courseId: string,
    lessonIds: string[],
  ): Promise<void> {
    const locale = this.i18n.currentLocale() as ContentLocale;
    try {
      const lessons = await this.lessonsByCourse(courseId);
      const moduleIds = [
        ...new Set(
          lessons.map((l) => l.moduleId).filter((x): x is string => !!x),
        ),
      ];
      const plan: [TranslatableEntityType, string[], string[]][] = [
        ['COURSE', [courseId], ['title', 'description']],
        ['MODULE', moduleIds, ['title']],
        ['LESSON', lessonIds, ['title', 'contentJson']],
      ];
      for (const [type, ids, fields] of plan) {
        for (let i = 0; i < ids.length; i += TRANSLATION_BATCH) {
          const chunk = ids.slice(i, i + TRANSLATION_BATCH);
          if (chunk.length === 0) continue;
          const res = await this.translations.resolve(
            type,
            chunk,
            locale,
            fields,
          );
          for (const [entityId, byField] of Object.entries(res.items ?? {})) {
            const values: Record<string, string> = {};
            for (const [field, v] of Object.entries(byField ?? {})) {
              if (v && !v.fallback && typeof v.value === 'string')
                values[field] = v.value;
            }
            if (Object.keys(values).length === 0) continue;
            const row: TranslationRow = {
              key: `${locale}|${type}|${entityId}`,
              courseId,
              locale,
              entityType: type,
              entityId,
              fields: values,
            };
            if (idbAvailable()) {
              await tx(STORE_DL_TRANSLATIONS, 'readwrite', (s) => s.put(row));
            }
          }
        }
      }
    } catch {
      /* translations are best-effort: content falls back to the source locale */
    }
  }

  /** Recompute lessonCount + totalBytes for a course from what's stored. */
  private async recount(courseId: string): Promise<void> {
    const rec = this.recordFor(courseId);
    if (!rec) return;
    const lessons = await this.lessonsByCourse(courseId).catch(() => []);
    const translations = await this.translationsByCourse(courseId).catch(
      () => [],
    );
    const imageBytes = lessons.reduce(
      (s, l) => s + Math.max(0, l.sizeBytes - jsonBytes(stripSize(l))),
      0,
    );
    const bytes =
      lessons.reduce((s, l) => s + l.sizeBytes, 0) +
      translations.reduce((s, t) => s + jsonBytes(t), 0) +
      jsonBytes({ ...rec, imageUrls: undefined });
    await this.putRecord({
      ...(this.recordFor(courseId) ?? rec),
      lessonCount: lessons.length,
      totalBytes: bytes,
      imageBytes,
    });
  }

  /** Ask the user to free space; on accept, evict the plan and resolve true. */
  private async askForSpace(
    courseId: string | null,
    title: string | null,
    overBytes: number,
  ): Promise<boolean> {
    if (this.spaceResolver) this.resolveSpaceRequest(false);
    const plan = planEviction(this.downloads(), overBytes, courseId);
    const accepted = await new Promise<boolean>((resolve) => {
      this.spaceResolver = resolve;
      this.spaceRequest.set({
        courseId,
        title,
        overBytes,
        evict: plan.evict,
        insufficient: plan.insufficient,
      });
    });
    if (!accepted || plan.insufficient) {
      this.telemetry.track('storage_prompt_declined', { courseId, overBytes });
      if (courseId && this.jobs()[courseId])
        this.patchJob(courseId, { state: 'needsSpace' });
      return false;
    }
    for (const r of plan.evict) await this.removeCourse(r.courseId);
    this.telemetry.track('download_eviction', {
      courseIds: plan.evict.map((r) => r.courseId),
      bytes: plan.freed,
      forCourseId: courseId,
    });
    return true;
  }

  /** Opportunistic work once downloads are allowed (Wi-Fi / online). */
  private maintenanceRunning = false;
  private async backgroundMaintenance(): Promise<void> {
    if (this.maintenanceRunning) return;
    this.maintenanceRunning = true;
    try {
      await this.hydrate();
      if (this.downloads().length > 0) {
        await this.checkForUpdates();
        if (this.prefs().autoUpdate && !this.network.metered()) {
          for (const r of this.downloads()) {
            if (r.updateAvailable && !this.jobs()[r.courseId]) {
              await this.updateCourse(r.courseId).catch(() => null);
            }
          }
        }
      }
    } finally {
      this.maintenanceRunning = false;
    }
  }

  private async requestPersistence(): Promise<void> {
    try {
      if (
        navigator.storage?.persisted &&
        !(await navigator.storage.persisted())
      ) {
        await navigator.storage.persist?.();
      }
    } catch {
      /* best-effort */
    }
  }

  private dropJob(courseId: string): void {
    this.jobs.update((m) => {
      const next = { ...m };
      delete next[courseId];
      return next;
    });
  }

  private patchJob(courseId: string, patch: Partial<Job>): void {
    this.jobs.update((m) =>
      m[courseId] ? { ...m, [courseId]: { ...m[courseId], ...patch } } : m,
    );
  }

  private async putRecord(rec: DownloadRecord): Promise<void> {
    if (idbAvailable())
      await tx(STORE_DOWNLOADS, 'readwrite', (s) => s.put(rec));
    this.downloads.update((rs) => {
      const i = rs.findIndex((r) => r.courseId === rec.courseId);
      if (i === -1) return [...rs, rec];
      const next = [...rs];
      next[i] = rec;
      return next;
    });
  }

  private async deleteLesson(lessonId: string): Promise<void> {
    if (!idbAvailable()) return;
    await tx(STORE_DL_LESSONS, 'readwrite', (s) => s.delete(lessonId));
  }

  private async deleteTranslations(courseId: string): Promise<void> {
    if (!idbAvailable()) return;
    const rows = await this.translationsByCourse(courseId).catch(() => []);
    for (const r of rows)
      await tx(STORE_DL_TRANSLATIONS, 'readwrite', (s) => s.delete(r.key));
  }

  private async refresh(): Promise<void> {
    if (!idbAvailable()) return;
    this.downloads.set(await this.allRecords());
  }

  private readPrefs(): DownloadPrefs {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    } catch {
      /* ignore */
    }
    return { ...DEFAULT_PREFS };
  }

  private allRecords(): Promise<DownloadRecord[]> {
    return tx<DownloadRecord[]>(
      STORE_DOWNLOADS,
      'readonly',
      (store) =>
        new Promise<DownloadRecord[]>((resolve, reject) => {
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result as DownloadRecord[]);
          req.onerror = () => reject(req.error);
        }),
    );
  }

  private lessonsByCourse(courseId: string): Promise<DownloadedLesson[]> {
    if (!idbAvailable()) return Promise.resolve([]);
    return tx<DownloadedLesson[]>(
      STORE_DL_LESSONS,
      'readonly',
      (store) =>
        new Promise<DownloadedLesson[]>((resolve, reject) => {
          const req = store.index('byCourse').getAll(courseId);
          req.onsuccess = () => resolve(req.result as DownloadedLesson[]);
          req.onerror = () => reject(req.error);
        }),
    );
  }

  private translationsByCourse(courseId: string): Promise<TranslationRow[]> {
    if (!idbAvailable()) return Promise.resolve([]);
    return tx<TranslationRow[]>(
      STORE_DL_TRANSLATIONS,
      'readonly',
      (store) =>
        new Promise<TranslationRow[]>((resolve, reject) => {
          const req = store.index('byCourse').getAll(courseId);
          req.onsuccess = () => resolve(req.result as TranslationRow[]);
          req.onerror = () => reject(req.error);
        }),
    );
  }
}

/** Free lessons + every lesson of the first module that has a paid lesson. */
export function autoDownloadSelection(detail: CourseDetail): string[] {
  const free = detail.modules.flatMap((m) =>
    m.lessons.filter((l) => l.isFree).map((l) => l.id),
  );
  const firstPaid = [...detail.modules]
    .sort((a, b) => a.order - b.order)
    .find((m) => m.lessons.some((l) => !l.isFree));
  return [
    ...new Set([...free, ...(firstPaid?.lessons.map((l) => l.id) ?? [])]),
  ];
}

function mergeScope(
  prev: DownloadScope | undefined,
  next: DownloadScope,
): DownloadScope {
  if (prev === 'course' || next === 'course') return 'course';
  if (prev === 'auto' || next === 'auto') return 'auto';
  if (prev === 'module' || next === 'module') return 'module';
  return 'lesson';
}

function toDownloadedLesson(
  bundle: LessonOfflineBundle,
  courseId: string,
  imageBytes: number,
): DownloadedLesson {
  const m = bundle.lesson;
  const base: DownloadedLesson = {
    lessonId: m.id,
    courseId,
    moduleId: m.moduleId,
    order: m.order,
    title: m.title,
    type: m.type,
    isFree: m.isFree,
    baseXp: m.baseXp,
    baseCoins: m.baseCoins,
    estimatedMinutes: m.estimatedMinutes,
    contentJson: bundle.doc,
    updatedAt: bundle.updatedAt ?? m.updatedAt,
    quizAnswerHashes: bundle.quizAnswerHashes,
    imageSrcs: bundle.imageSrcs ?? [],
    sizeBytes: 0,
  };
  return { ...base, sizeBytes: jsonBytes(base) + imageBytes };
}

function stripSize(
  l: DownloadedLesson,
): Omit<DownloadedLesson, 'sizeBytes'> & { sizeBytes: 0 } {
  return { ...l, sizeBytes: 0 };
}

function describeError(err: unknown): string {
  const p = toProblemDetails(err);
  return p.status ? `http_${p.status}` : 'network';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
