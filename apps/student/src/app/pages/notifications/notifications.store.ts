import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  NotificationsClient,
  type InboxNotification,
} from '@codify/api-client';
import { AuthService } from '@codify/auth';
import { NetworkStatusService } from '../../offline/network-status.service.js';
import { mergeInbox } from './inbox-grouping.js';

/** Unread count refresh while the app is visible. */
export const UNREAD_POLL_MS = 120_000;
const PAGE_SIZE = 20;
/** Entries kept on the device for the offline inbox. */
const CACHE_MAX = 50;
const CACHE_PREFIX = 'codify.inbox.';

interface CachedInbox {
  items: InboxNotification[];
  unread: number;
  savedAt: number;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Notification inbox state shared by the bell and the inbox page (docs/05
 * Notifications): unread count (polled every 2 min while visible + online,
 * and on focus / reconnect), the newest-first list with cursor paging,
 * read / read-all / "fewer like this" with optimistic updates, and the last
 * inbox cached per user in localStorage so it still renders offline.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsStore {
  private readonly client = inject(NotificationsClient);
  private readonly auth = inject(AuthService);
  private readonly network = inject(NetworkStatusService);

  private readonly _items = signal<InboxNotification[]>([]);
  private readonly _unread = signal(0);
  private readonly _nextCursor = signal<string | null>(null);
  private readonly _loading = signal(false);
  private readonly _loadingMore = signal(false);
  private readonly _error = signal(false);
  private readonly _fromCache = signal(false);
  private readonly _loaded = signal(false);

  readonly items = this._items.asReadonly();
  readonly unread = this._unread.asReadonly();
  readonly hasMore = computed(() => this._nextCursor() !== null);
  readonly loading = this._loading.asReadonly();
  readonly loadingMore = this._loadingMore.asReadonly();
  readonly error = this._error.asReadonly();
  /** The list shown is the device copy (offline / server unreachable). */
  readonly fromCache = this._fromCache.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  private started = false;
  private userKey: string | null = null;

  constructor() {
    // Account switch / sign-out → drop the previous user's inbox.
    effect(() => {
      const id = this.auth.user()?.id ?? null;
      untracked(() => {
        if (id === this.userKey) return;
        this.userKey = id;
        this.reset();
        if (id) this.restoreCache();
        if (id && this.started) void this.refreshUnread();
      });
    });
    effect(() => {
      if (this.network.online() && this.started)
        untracked(() => void this.refreshUnread());
    });
  }

  /**
   * Begin polling the unread count for the app's lifetime (idempotent; the
   * bell calls this). Polls only while visible, online and signed in.
   */
  start(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    void this.refreshUnread();
    setInterval(() => {
      if (document.visibilityState === 'visible') void this.refreshUnread();
    }, UNREAD_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.refreshUnread();
    };
    document.addEventListener('visibilitychange', onVisible);
  }

  async refreshUnread(): Promise<void> {
    if (!this.userKey || !this.network.online()) return;
    try {
      const { count } = await this.client.unreadCount();
      this._unread.set(count);
      this.saveCache();
    } catch {
      /* keep the last known count */
    }
  }

  /** First page (newest). Falls back to the device copy when it can't load. */
  async load(): Promise<void> {
    if (!this.network.online()) {
      this.useCache();
      return;
    }
    this._loading.set(true);
    this._error.set(false);
    try {
      const [page, unread] = await Promise.all([
        this.client.list({ limit: PAGE_SIZE }),
        this.client.unreadCount(),
      ]);
      this._items.set(page.items);
      this._nextCursor.set(page.nextCursor);
      this._unread.set(unread.count);
      this._fromCache.set(false);
      this._loaded.set(true);
      this.saveCache();
    } catch {
      if (!this.useCache()) this._error.set(true);
    } finally {
      this._loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    const cursor = this._nextCursor();
    if (!cursor || this._loadingMore() || !this.network.online()) return;
    this._loadingMore.set(true);
    try {
      const page = await this.client.list({ cursor, limit: PAGE_SIZE });
      this._items.update((cur) => mergeInbox(cur, page.items));
      this._nextCursor.set(page.nextCursor);
    } finally {
      this._loadingMore.set(false);
    }
  }

  /** Optimistic; reverts when the server refuses. */
  async markRead(n: InboxNotification): Promise<void> {
    if (n.readAt) return;
    const readAt = new Date().toISOString();
    this.patch(n.id, { readAt });
    this._unread.update((c) => Math.max(0, c - 1));
    try {
      await this.client.markRead(n.id);
      this.saveCache();
    } catch (err) {
      this.patch(n.id, { readAt: null });
      this._unread.update((c) => c + 1);
      throw err;
    }
  }

  async markAllRead(): Promise<void> {
    const before = this._items();
    const unreadBefore = this._unread();
    const now = new Date().toISOString();
    this._items.set(before.map((i) => (i.readAt ? i : { ...i, readAt: now })));
    this._unread.set(0);
    try {
      await this.client.markAllRead();
      this.saveCache();
    } catch (err) {
      this._items.set(before);
      this._unread.set(unreadBefore);
      throw err;
    }
  }

  /** "Fewer like this" → the kind's new fewerLevel. */
  async fewer(n: InboxNotification): Promise<number> {
    const res = await this.client.fewer(n.id);
    return res.fewerLevel;
  }

  private patch(id: string, change: Partial<InboxNotification>): void {
    this._items.update((list) =>
      list.map((i) => (i.id === id ? { ...i, ...change } : i)),
    );
  }

  private reset(): void {
    this._items.set([]);
    this._unread.set(0);
    this._nextCursor.set(null);
    this._error.set(false);
    this._fromCache.set(false);
    this._loaded.set(false);
  }

  // ─── Device cache (offline inbox) ────────────────────────────────────

  private cacheKey(): string | null {
    return this.userKey ? CACHE_PREFIX + this.userKey : null;
  }

  private readCache(): CachedInbox | null {
    const key = this.cacheKey();
    const s = storage();
    if (!key || !s) return null;
    try {
      const raw = s.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedInbox;
      return Array.isArray(parsed.items) ? parsed : null;
    } catch {
      return null;
    }
  }

  private restoreCache(): void {
    const cached = this.readCache();
    if (cached) this._unread.set(cached.unread ?? 0);
  }

  /** Show the device copy; false when there is none. */
  private useCache(): boolean {
    const cached = this.readCache();
    if (!cached) return false;
    this._items.set(cached.items);
    this._unread.set(cached.unread ?? 0);
    this._nextCursor.set(null);
    this._fromCache.set(true);
    this._loaded.set(true);
    return true;
  }

  private saveCache(): void {
    const key = this.cacheKey();
    const s = storage();
    if (!key || !s) return;
    try {
      // Only a server-fresh list replaces the stored one.
      const items =
        this._loaded() && !this._fromCache()
          ? this._items()
          : (this.readCache()?.items ?? []);
      const entry: CachedInbox = {
        items: items.slice(0, CACHE_MAX),
        unread: this._unread(),
        savedAt: Date.now(),
      };
      s.setItem(key, JSON.stringify(entry));
    } catch {
      /* quota / private mode: best-effort */
    }
  }
}
