import { Injectable, computed, signal } from '@angular/core';
import type { AuthSession, AuthState, AuthUser, UserRole } from './types.js';

const STUB_USER_KEY = 'codify.auth.user';
const STUB_TOKEN_KEY = 'codify.auth.token';

/**
 * Single source of truth for the current user across both apps. Today
 * this is a stub backed by localStorage so dev work can proceed without
 * a running Clerk tenant; once Phase 4b lands, the same surface is
 * driven by the Clerk SDK (signals are unchanged from caller's POV).
 *
 * Use `provideAuth()` from `provider.ts` to register the service +
 * interceptor + guards — never inject this directly outside of the lib.
 *
 * The dev convenience methods `signInAs(role)` / `signOut()` exist so a
 * "Login" page can flip role without an external auth provider.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly state = signal<AuthState>({
    user: null,
    session: null,
    loading: true,
  });

  readonly user = computed(() => this.state().user);
  readonly role = computed(() => this.state().user?.role ?? null);
  readonly isAuthenticated = computed(() => this.state().user !== null);
  readonly loading = computed(() => this.state().loading);
  readonly session = computed(() => this.state().session);

  constructor() {
    this.hydrateFromStorage();
  }

  /** Snapshot of the current bearer token (or null) — for the interceptor. */
  currentToken(): string | null {
    return this.state().session?.token ?? null;
  }

  /** Returns true if the user has any of the listed roles. */
  hasAnyRole(roles: readonly UserRole[]): boolean {
    const r = this.role();
    if (!r) return false;
    if (roles.length === 0) return true; // any authenticated role qualifies
    return roles.includes(r);
  }

  /**
   * Dev-only: sign in as a specific role with a synthetic user record.
   * Useful for the dev login page until Clerk is wired in Phase 4b.
   */
  signInAs(role: UserRole, opts: Partial<AuthUser> = {}): void {
    const user: AuthUser = {
      id: opts.id ?? `dev-${role.toLowerCase()}`,
      email: opts.email ?? `${role.toLowerCase()}@codify.local`,
      displayName: opts.displayName ?? defaultDisplayName(role),
      role,
      avatarUrl: opts.avatarUrl ?? null,
      locale: opts.locale ?? 'pt-BR',
    };
    const session: AuthSession = {
      token: opts.id ? `dev-token-${opts.id}` : `dev-token-${role.toLowerCase()}`,
      expiresAt: null,
    };
    this.state.set({ user, session, loading: false });
    this.persist(user, session);
  }

  /**
   * Patch the signed-in user with a partial update — `displayName`, `locale`,
   * `avatarUrl`, etc. No-op when unauthenticated. Persists immediately so a
   * page reload keeps the change.
   *
   * In Phase 4b/Clerk this will additionally call the API to mirror the
   * change server-side; for stub mode it's local-only.
   */
  updateProfile(patch: Partial<Omit<AuthUser, 'id' | 'role'>>): void {
    const current = this.state();
    if (!current.user || !current.session) return;
    const user: AuthUser = { ...current.user, ...patch };
    this.state.set({ ...current, user });
    this.persist(user, current.session);
  }

  /** Clear local state + storage. Throws no errors when already signed out. */
  signOut(): void {
    this.state.set({ user: null, session: null, loading: false });
    try {
      localStorage.removeItem(STUB_USER_KEY);
      localStorage.removeItem(STUB_TOKEN_KEY);
    } catch {
      /* private-browsing — ignore */
    }
  }

  /**
   * Replace the user/session pair. Used by the interceptor on `401` responses
   * to clear stale tokens, and by the Phase 4b Clerk integration when a fresh
   * session JWT lands.
   */
  setSession(user: AuthUser | null, session: AuthSession | null): void {
    this.state.set({ user, session, loading: false });
    if (user && session) this.persist(user, session);
    else this.signOut();
  }

  private hydrateFromStorage(): void {
    try {
      const rawUser = localStorage.getItem(STUB_USER_KEY);
      const rawToken = localStorage.getItem(STUB_TOKEN_KEY);
      if (rawUser && rawToken) {
        const user = JSON.parse(rawUser) as AuthUser;
        const session = JSON.parse(rawToken) as AuthSession;
        this.state.set({ user, session, loading: false });
        return;
      }
    } catch {
      /* corrupted storage — fall through to unauthenticated */
    }
    this.state.set({ user: null, session: null, loading: false });
  }

  private persist(user: AuthUser, session: AuthSession): void {
    try {
      localStorage.setItem(STUB_USER_KEY, JSON.stringify(user));
      localStorage.setItem(STUB_TOKEN_KEY, JSON.stringify(session));
    } catch {
      /* private-browsing — ignore */
    }
  }
}

function defaultDisplayName(role: UserRole): string {
  switch (role) {
    case 'STUDENT':
      return 'Maria Souza';
    case 'TEACHER':
      return 'Lucas Professor';
    case 'SUPPORT':
      return 'Suporte';
    case 'ADMIN':
      return 'Admin';
  }
}
