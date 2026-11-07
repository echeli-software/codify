import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import { AuthService } from '@codify/auth';
import { FlagsClient, type FlagEvaluation } from '@codify/api-client';

/** Flags the student shell consumes (docs/04 Settings, docs/10 §9). */
export type StudentFeature =
  | 'leagues.enabled'
  | 'friends.enabled'
  | 'shop.enabled';

/** Built-in product surfaces default ON until the server says otherwise. */
const DEFAULT_ON: ReadonlySet<string> = new Set<StudentFeature>([
  'leagues.enabled',
  'friends.enabled',
  'shop.enabled',
]);

const STORAGE_KEY = 'cdf.flags.v1';
/** How long a route guard waits for the first load before falling back. */
const GUARD_WAIT_MS = 3000;

/**
 * The caller's evaluated feature flags (GET /flags). Loaded on sign-in /
 * user switch, cached in localStorage so navigation is stable offline and
 * on the next cold start. UX only — the API gates the same surfaces with
 * 404 FEATURE_DISABLED.
 *
 * Unknown flags read as off, except the built-in surfaces (leagues,
 * friends, shop) which read as on until a load says otherwise, so a slow
 * or failed load never hides working features.
 */
@Injectable({ providedIn: 'root' })
export class FeatureFlagsService {
  private readonly client = inject(FlagsClient);
  private readonly auth = inject(AuthService);

  private readonly _flags = signal<Record<string, FlagEvaluation>>(readCache());
  private readonly _loaded = signal(false);
  private loading: Promise<void> | null = null;
  private lastUser: string | null | undefined = undefined;

  readonly flags = this._flags.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  readonly leaguesEnabled = computed(() => this.isOn('leagues.enabled'));
  readonly friendsEnabled = computed(() => this.isOn('friends.enabled'));
  readonly shopEnabled = computed(() => this.isOn('shop.enabled'));

  constructor() {
    effect(() => {
      const id = this.auth.user()?.id ?? null;
      untracked(() => {
        if (id === this.lastUser) return;
        this.lastUser = id;
        this._loaded.set(false);
        void this.load();
      });
    });
  }

  /** Signal-friendly read for any flag. */
  isOn(key: string): boolean {
    const f = this._flags()[key];
    return f ? f.enabled : DEFAULT_ON.has(key);
  }

  /** The A/B variant for the caller (null: no variants / not enrolled). */
  variant(key: string): string | null {
    return this._flags()[key]?.variant ?? null;
  }

  /** (Re)load from the API; failures keep the last known map. */
  load(): Promise<void> {
    if (!this.loading) {
      this.loading = this.client
        .mine()
        .then((flags) => {
          this._flags.set(flags);
          writeCache(flags);
        })
        .catch(() => undefined)
        .finally(() => {
          this._loaded.set(true);
          this.loading = null;
        });
    }
    return this.loading;
  }

  /** Resolves once the first load settled (or after `ms`). */
  async whenLoaded(ms = GUARD_WAIT_MS): Promise<void> {
    if (this._loaded()) return;
    const pending = this.loading ?? this.load();
    await Promise.race([pending, new Promise<void>((r) => setTimeout(r, ms))]);
  }
}

/** Route guard: a disabled surface redirects to Today. */
export function featureGuard(key: StudentFeature): CanActivateFn {
  return async (): Promise<boolean | UrlTree> => {
    const flags = inject(FeatureFlagsService);
    const router = inject(Router);
    await flags.whenLoaded();
    return flags.isOn(key) ? true : router.createUrlTree(['/today']);
  };
}

function readCache(): Record<string, FlagEvaluation> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, FlagEvaluation>)
      : {};
  } catch {
    return {};
  }
}

function writeCache(flags: Record<string, FlagEvaluation>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(flags));
  } catch {
    // Storage full / disabled: the in-memory map still works.
  }
}
