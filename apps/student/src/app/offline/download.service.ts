import { Injectable, computed, inject, signal } from '@angular/core';
import { CoursesClient, LessonsClient, type Lesson } from '@codify/api-client';
import { idbStores, tx } from './db.js';

const { STORE_DOWNLOADS, STORE_DL_LESSONS, STORE_ASSETS } = idbStores;
const PREFS_KEY = 'codify.downloads.prefs';
const DEFAULT_BUDGET = 1024 * 1024 * 1024; // 1 GB

export type DownloadStatus = 'downloading' | 'complete' | 'partial';

export interface DownloadRecord {
  courseId: string;
  courseSlug: string;
  title: string;
  lessonCount: number;
  totalBytes: number;
  status: DownloadStatus;
  downloadedAt: number;
  lastReadAt: number;
  /** Course.updatedAt at download time — drives the "update available" flag. */
  sourceUpdatedAt: string;
}

export interface DownloadedLesson {
  lessonId: string;
  courseId: string;
  title: string;
  type: string;
  isFree: boolean;
  baseXp: number;
  baseCoins: number;
  contentJson: unknown;
  sizeBytes: number;
}

export interface DownloadProgress {
  courseId: string;
  current: number;
  total: number;
  status: DownloadStatus | 'cancelled';
}

export interface DownloadPrefs {
  wifiOnly: boolean;
  autoUpdate: boolean;
  budgetBytes: number;
}

const DEFAULT_PREFS: DownloadPrefs = { wifiOnly: true, autoUpdate: true, budgetBytes: DEFAULT_BUDGET };

/** Rough byte size of a JSON-serializable value. */
function sizeOf(value: unknown): number {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return JSON.stringify(value).length;
  }
}

/**
 * Explicit-download engine + offline content cache (docs/16-offline §5–§9).
 * Stores LessonDoc JSON + lesson/course metadata in IndexedDB so downloaded
 * courses read offline; enforces a storage budget with LRU eviction by
 * `lastReadAt`. Reactive `downloads` + `progress` signals drive the UI.
 */
@Injectable({ providedIn: 'root' })
export class DownloadService {
  private readonly coursesClient = inject(CoursesClient);
  private readonly lessonsClient = inject(LessonsClient);

  /** All download records (reactive). */
  readonly downloads = signal<DownloadRecord[]>([]);
  /** In-flight progress per course id. */
  readonly progress = signal<Record<string, DownloadProgress>>({});
  readonly prefs = signal<DownloadPrefs>(this.readPrefs());

  /** Total bytes used across all downloads. */
  readonly totalBytes = computed(() => this.downloads().reduce((s, d) => s + d.totalBytes, 0));

  private readonly cancelled = new Set<string>();
  private hydrated = false;

  /** Load records from IndexedDB into the reactive signal (once). */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    this.downloads.set(await this.allRecords());
  }

  isDownloaded(courseId: string): boolean {
    return this.downloads().some((d) => d.courseId === courseId && d.status === 'complete');
  }

  recordFor(courseId: string): DownloadRecord | undefined {
    return this.downloads().find((d) => d.courseId === courseId);
  }

  /** True when the cached source predates the live course content. */
  updateAvailable(courseId: string, liveUpdatedAt: string | undefined): boolean {
    const rec = this.recordFor(courseId);
    if (!rec || !liveUpdatedAt) return false;
    return new Date(liveUpdatedAt).getTime() > new Date(rec.sourceUpdatedAt).getTime();
  }

  /**
   * Download (or update) a course for offline reading: course detail + every
   * lesson's content. Reports progress; cancellable; evicts LRU downloads to
   * stay under budget.
   */
  async downloadCourse(idOrSlug: string): Promise<DownloadRecord | null> {
    const detail = await this.coursesClient.detail(idOrSlug);
    const courseId = detail.id;
    this.cancelled.delete(courseId);

    const lessonRefs = detail.modules.flatMap((m) => m.lessons.map((l) => ({ id: l.id })));
    const total = lessonRefs.length;
    this.setProgress({ courseId, current: 0, total, status: 'downloading' });

    let bytes = 0;
    let done = 0;
    for (const ref of lessonRefs) {
      if (this.cancelled.has(courseId)) {
        this.setProgress({ courseId, current: done, total, status: 'cancelled' });
        await this.removeCourse(courseId);
        return null;
      }
      const lesson = await this.lessonsClient.detail(ref.id);
      const dl = toDownloadedLesson(lesson, courseId);
      bytes += dl.sizeBytes;
      await tx(STORE_DL_LESSONS, 'readwrite', (s) => s.put(dl));
      done += 1;
      this.setProgress({ courseId, current: done, total, status: 'downloading' });
    }

    const record: DownloadRecord = {
      courseId,
      courseSlug: detail.slug,
      title: detail.title,
      lessonCount: total,
      totalBytes: bytes,
      status: 'complete',
      downloadedAt: Date.now(),
      lastReadAt: Date.now(),
      sourceUpdatedAt: detail.updatedAt,
    };
    await tx(STORE_DOWNLOADS, 'readwrite', (s) => s.put(record));
    await this.refresh();
    this.clearProgress(courseId);
    await this.enforceBudget(courseId);
    return record;
  }

  cancel(courseId: string): void {
    this.cancelled.add(courseId);
  }

  async removeCourse(courseId: string): Promise<void> {
    const lessons = await this.lessonsByCourse(courseId);
    for (const l of lessons) await tx(STORE_DL_LESSONS, 'readwrite', (s) => s.delete(l.lessonId));
    await tx(STORE_DOWNLOADS, 'readwrite', (s) => s.delete(courseId));
    await this.refresh();
  }

  async removeAll(): Promise<void> {
    for (const rec of [...this.downloads()]) await this.removeCourse(rec.courseId);
  }

  async getDownloadedLesson(lessonId: string): Promise<DownloadedLesson | null> {
    const l = await tx<DownloadedLesson | undefined>(STORE_DL_LESSONS, 'readonly', (s) => s.get(lessonId));
    return l ?? null;
  }

  // ─── Asset prefetch (offline dressing room) ──────────────────────────────

  /**
   * Cache the avatar + inventory bundle so the dressing room renders offline
   * (docs/16 §6: a signed-in user's avatar must always render offline).
   */
  async prefetchAssets(bundle: { avatar: unknown; inventory: unknown }): Promise<void> {
    await tx(STORE_ASSETS, 'readwrite', (s) => s.put({ ...bundle, cachedAt: Date.now() }, 'current'));
  }

  async getCachedAssets(): Promise<{ avatar: unknown; inventory: unknown } | null> {
    const v = await tx<{ avatar: unknown; inventory: unknown } | undefined>(
      STORE_ASSETS,
      'readonly',
      (s) => s.get('current'),
    );
    return v ?? null;
  }

  /** Touch a course's lastReadAt so it survives LRU eviction. */
  async markRead(courseId: string): Promise<void> {
    const rec = this.recordFor(courseId);
    if (!rec) return;
    const updated = { ...rec, lastReadAt: Date.now() };
    await tx(STORE_DOWNLOADS, 'readwrite', (s) => s.put(updated));
    this.downloads.update((rs) => rs.map((r) => (r.courseId === courseId ? updated : r)));
  }

  // ─── Prefs ──────────────────────────────────────────────────────────────

  setPrefs(patch: Partial<DownloadPrefs>): void {
    const next = { ...this.prefs(), ...patch };
    this.prefs.set(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      /* private mode — ignore */
    }
    if (patch.budgetBytes != null) void this.enforceBudget();
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

  // ─── Budget / LRU ─────────────────────────────────────────────────────────

  /** Evict least-recently-read courses until under budget (never the keeper). */
  private async enforceBudget(keepCourseId?: string): Promise<void> {
    const budget = this.prefs().budgetBytes;
    let used = this.totalBytes();
    if (used <= budget) return;
    const candidates = [...this.downloads()]
      .filter((d) => d.courseId !== keepCourseId)
      .sort((a, b) => a.lastReadAt - b.lastReadAt); // oldest first
    for (const c of candidates) {
      if (used <= budget) break;
      await this.removeCourse(c.courseId);
      used -= c.totalBytes;
    }
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private setProgress(p: DownloadProgress): void {
    this.progress.update((m) => ({ ...m, [p.courseId]: p }));
  }
  private clearProgress(courseId: string): void {
    this.progress.update((m) => {
      const { [courseId]: _omit, ...rest } = m;
      return rest;
    });
  }

  private async refresh(): Promise<void> {
    this.downloads.set(await this.allRecords());
  }

  private allRecords(): Promise<DownloadRecord[]> {
    return tx<DownloadRecord[]>(STORE_DOWNLOADS, 'readonly', (store) =>
      new Promise<DownloadRecord[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result as DownloadRecord[]);
        req.onerror = () => reject(req.error);
      }),
    );
  }

  private lessonsByCourse(courseId: string): Promise<DownloadedLesson[]> {
    return tx<DownloadedLesson[]>(STORE_DL_LESSONS, 'readonly', (store) =>
      new Promise<DownloadedLesson[]>((resolve, reject) => {
        const idx = store.index('byCourse');
        const req = idx.getAll(courseId);
        req.onsuccess = () => resolve(req.result as DownloadedLesson[]);
        req.onerror = () => reject(req.error);
      }),
    );
  }
}

function toDownloadedLesson(lesson: Lesson, courseId: string): DownloadedLesson {
  const base = {
    lessonId: lesson.id,
    courseId,
    title: lesson.title,
    type: lesson.type,
    isFree: lesson.isFree,
    baseXp: lesson.baseXp,
    baseCoins: lesson.baseCoins,
    contentJson: lesson.contentJson,
  };
  return { ...base, sizeBytes: sizeOf(base) };
}
