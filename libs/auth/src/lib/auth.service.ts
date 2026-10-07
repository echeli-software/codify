import { HttpBackend, HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AUTH_CONFIG, CLERK_LOADER, type ClerkLike } from './config.js';
import type { AuthSession, AuthState, AuthUser, UserRole } from './types.js';

const STUB_USER_KEY = 'codify.auth.user';
const STUB_TOKEN_KEY = 'codify.auth.token';
/** Clerk mode: last profile resolved from `/me`, for offline starts. */
const PROFILE_CACHE_KEY = 'codify.auth.profile';

/** The subset of `GET /api/me` the auth layer needs. */
interface MeResponse {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  locale?: string;
}

interface CachedProfile {
  clerkUserId: string;
  user: AuthUser;
}

export type AuthMode = 'clerk' | 'dev';

/**
 * Single source of truth for the current user across both apps.
 *
 * Two modes, picked by `provideAuth({ clerkPublishableKey })`:
 *
 *  - **clerk** — @clerk/clerk-js is lazy-loaded; Clerk owns the session
 *    (sign-in UI, refresh, sign-out). The user's *role* and profile come
 *    from the API (`GET {apiBaseUrl}/me`), never from Clerk, because the
 *    server is the authority on roles. `getToken()` returns a fresh Clerk
 *    session JWT for every request.
 *  - **dev** — no key configured: a localStorage-backed stub with the
 *    `signInAs(role)` role picker, producing `dev-token-<role>` tokens the
 *    API accepts only with ALLOW_DEV_AUTH=true outside production.
 *
 * The signal surface (`user`, `role`, `isAuthenticated`, `loading`) is the
 * same in both modes.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly config = inject(AUTH_CONFIG);
  private readonly loadClerk = inject(CLERK_LOADER);
  private readonly backend = inject(HttpBackend, { optional: true });
  private readonly router = inject(Router, { optional: true });

  readonly mode: AuthMode = this.config.clerkPublishableKey ? 'clerk' : 'dev';

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

  private clerk: ClerkLike | null = null;
  private clerkUserId: string | null = null;
  private sync: { forUser: string; promise: Promise<void> } | null = null;
  private readonly ready: Promise<void>;

  constructor() {
    if (this.mode === 'dev') {
      this.hydrateFromStorage();
      this.ready = Promise.resolve();
    } else {
      this.ready = this.initClerk(this.config.clerkPublishableKey as string);
    }
  }

  /** Resolves once the initial auth state is known (Clerk loaded + `/me`). */
  whenReady(): Promise<void> {
    return this.ready;
  }

  /** Snapshot of the last-known bearer token (or null). Prefer `getToken()`. */
  currentToken(): string | null {
    return this.state().session?.token ?? null;
  }

  /**
   * Bearer token for an API request. Clerk mode returns a fresh session
   * JWT (Clerk caches and refreshes it); dev mode returns the stub token.
   */
  async getToken(): Promise<string | null> {
    if (this.mode === 'dev') return this.currentToken();
    await this.ready;
    const session = this.clerk?.session;
    if (!session) return null;
    try {
      return await session.getToken();
    } catch {
      return null;
    }
  }

  /** Returns true if the user has any of the listed roles. */
  hasAnyRole(roles: readonly UserRole[]): boolean {
    const r = this.role();
    if (!r) return false;
    if (roles.length === 0) return true; // any authenticated role qualifies
    return roles.includes(r);
  }

  /**
   * Dev mode only: sign in as a role with a synthetic user record. Throws in
   * Clerk mode (the login page renders Clerk's sign-in instead).
   */
  signInAs(role: UserRole, opts: Partial<AuthUser> = {}): void {
    if (this.mode !== 'dev') {
      throw new Error(
        'signInAs() is only available when Clerk is not configured',
      );
    }
    const user: AuthUser = {
      id: opts.id ?? `dev-${role.toLowerCase()}`,
      email: opts.email ?? `${role.toLowerCase()}@codify.local`,
      displayName: opts.displayName ?? defaultDisplayName(role),
      role,
      avatarUrl: opts.avatarUrl ?? null,
      locale: opts.locale ?? 'pt-BR',
    };
    const session: AuthSession = {
      token: opts.id
        ? `dev-token-${opts.id}`
        : `dev-token-${role.toLowerCase()}`,
      expiresAt: null,
    };
    this.state.set({ user, session, loading: false });
    this.persist(user, session);
  }

  /**
   * Clerk mode: mount Clerk's sign-in component into `node`. After a
   * successful sign-in the user lands on `redirectUrl` (an in-app path).
   */
  async mountSignIn(
    node: HTMLDivElement,
    opts: { redirectUrl?: string } = {},
  ): Promise<void> {
    await this.ready;
    if (!this.clerk) throw new Error('Clerk is not available');
    const redirect = opts.redirectUrl ?? '/';
    this.clerk.mountSignIn(node, {
      forceRedirectUrl: redirect,
      fallbackRedirectUrl: redirect,
      signUpForceRedirectUrl: redirect,
    });
  }

  unmountSignIn(node: HTMLDivElement): void {
    this.clerk?.unmountSignIn(node);
  }

  /** Clerk mode: open Clerk's account-management modal. No-op in dev mode. */
  openUserProfile(): void {
    this.clerk?.openUserProfile();
  }

  /**
   * Patch the signed-in user locally (`displayName`, `locale`, …). No-op
   * when unauthenticated. Callers persist server-side via PATCH /me.
   */
  updateProfile(patch: Partial<Omit<AuthUser, 'id' | 'role'>>): void {
    const current = this.state();
    if (!current.user || !current.session) return;
    const user: AuthUser = { ...current.user, ...patch };
    this.state.set({ ...current, user });
    this.persist(user, current.session);
  }

  /** Re-read role/profile from `GET /me` (Clerk mode), e.g. after a role change. */
  async refreshProfile(): Promise<void> {
    if (this.mode !== 'clerk') return;
    await this.ready;
    this.clerkUserId = null;
    this.sync = null;
    await this.syncFromClerk();
  }

  /** Clear local state (and the Clerk session). Safe when already signed out. */
  signOut(): Promise<void> {
    this.state.set({ user: null, session: null, loading: false });
    this.clerkUserId = null;
    this.sync = null;
    this.clearStorage();
    if (this.clerk) return this.clerk.signOut().catch(() => undefined);
    return Promise.resolve();
  }

  /** Replace the user/session pair (tests, dev tooling). */
  setSession(user: AuthUser | null, session: AuthSession | null): void {
    if (user && session) {
      this.state.set({ user, session, loading: false });
      this.persist(user, session);
    } else {
      void this.signOut();
    }
  }

  // ─── Clerk mode ──────────────────────────────────────────────────────────

  private async initClerk(publishableKey: string): Promise<void> {
    try {
      const clerk = await this.loadClerk(publishableKey);
      await clerk.load({
        routerPush: (to: string) => this.navigate(to),
        routerReplace: (to: string) => this.navigate(to),
      });
      this.clerk = clerk;
      clerk.addListener(() => void this.syncFromClerk());
      await this.syncFromClerk();
    } catch (err) {
      console.error('[auth] Clerk failed to load', err);
      this.state.set({ user: null, session: null, loading: false });
    }
  }

  private navigate(to: string): void {
    const url = new URL(to, window.location.origin);
    if (url.origin !== window.location.origin || !this.router) {
      window.location.assign(to);
      return;
    }
    void this.router.navigateByUrl(url.pathname + url.search + url.hash);
  }

  /** Mirror Clerk's session into our state; role/profile from `/me`. */
  private syncFromClerk(): Promise<void> {
    const clerkUser = this.clerk?.user;
    const session = this.clerk?.session;
    if (!clerkUser || !session) {
      this.clerkUserId = null;
      this.sync = null;
      this.state.set({ user: null, session: null, loading: false });
      return Promise.resolve();
    }
    if (this.clerkUserId === clerkUser.id && this.state().user)
      return Promise.resolve();
    if (this.sync?.forUser === clerkUser.id) return this.sync.promise;
    const promise = this.resolveProfile(clerkUser, session);
    this.sync = { forUser: clerkUser.id, promise };
    return promise;
  }

  private async resolveProfile(
    clerkUser: NonNullable<ClerkLike['user']>,
    session: NonNullable<ClerkLike['session']>,
  ): Promise<void> {
    this.state.update((s) => ({ ...s, loading: true }));
    const token = await session.getToken().catch(() => null);
    try {
      if (!token) throw Object.assign(new Error('no token'), { status: 401 });
      const me = await this.fetchMe(token);
      if (this.clerk?.user?.id !== clerkUser.id) return; // superseded
      const user: AuthUser = {
        id: me.id,
        email: me.email,
        displayName: me.displayName,
        role: me.role,
        avatarUrl: clerkUser.imageUrl ?? null,
        locale: me.locale ?? 'pt-BR',
      };
      this.clerkUserId = clerkUser.id;
      this.state.set({
        user,
        session: { token, expiresAt: null },
        loading: false,
      });
      this.writeProfileCache({ clerkUserId: clerkUser.id, user });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 0;
      const cached = this.readProfileCache();
      if (status === 0 && token && cached?.clerkUserId === clerkUser.id) {
        // Offline / API unreachable: keep working with the last known profile.
        this.clerkUserId = clerkUser.id;
        this.state.set({
          user: cached.user,
          session: { token, expiresAt: null },
          loading: false,
        });
        return;
      }
      // The API refused this identity (deleted / suspended): end the session.
      this.sync = null;
      this.state.set({ user: null, session: null, loading: false });
      if (status === 401 || status === 403)
        await this.clerk?.signOut().catch(() => undefined);
    }
  }

  private fetchMe(token: string): Promise<MeResponse> {
    if (!this.backend)
      throw new Error('provideHttpClient() is required for Clerk auth');
    const base = (this.config.apiBaseUrl ?? '').replace(/\/+$/, '');
    // HttpBackend bypasses interceptors (no recursion through authInterceptor).
    const http = new HttpClient(this.backend);
    return firstValueFrom(
      http.get<MeResponse>(`${base}/me`, {
        headers: new HttpHeaders({ Authorization: `Bearer ${token}` }),
      }),
    );
  }

  private readProfileCache(): CachedProfile | null {
    try {
      const raw = localStorage.getItem(PROFILE_CACHE_KEY);
      return raw ? (JSON.parse(raw) as CachedProfile) : null;
    } catch {
      return null;
    }
  }

  private writeProfileCache(profile: CachedProfile): void {
    try {
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
    } catch {
      /* private browsing — ignore */
    }
  }

  // ─── Dev mode storage ────────────────────────────────────────────────────

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
      if (this.mode === 'clerk') {
        if (this.clerkUserId)
          this.writeProfileCache({ clerkUserId: this.clerkUserId, user });
        return; // Clerk owns the session; never persist its JWT.
      }
      localStorage.setItem(STUB_USER_KEY, JSON.stringify(user));
      localStorage.setItem(STUB_TOKEN_KEY, JSON.stringify(session));
    } catch {
      /* private browsing — ignore */
    }
  }

  private clearStorage(): void {
    try {
      localStorage.removeItem(STUB_USER_KEY);
      localStorage.removeItem(STUB_TOKEN_KEY);
      localStorage.removeItem(PROFILE_CACHE_KEY);
    } catch {
      /* private browsing — ignore */
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
