import { InjectionToken } from '@angular/core';

/**
 * Options for `provideAuth()`.
 *
 *   provideAuth({
 *     apiBaseUrl: 'https://api.codify.app/api',
 *     clerkPublishableKey: 'pk_live_…',   // omit → dev role picker
 *   })
 */
export interface AuthConfig {
  /**
   * Clerk publishable key. When set, AuthService is driven by Clerk
   * (@clerk/clerk-js, lazy-loaded). When absent, the dev role picker
   * (`signInAs`) is used and the API must run with ALLOW_DEV_AUTH=true.
   */
  clerkPublishableKey?: string | null;
  /**
   * API origin + prefix (e.g. `http://localhost:3000/api`). The bearer
   * token is attached ONLY to requests under this URL (plus
   * `tokenAllowlist`), and the user's role is read from `${apiBaseUrl}/me`.
   * Without it, only same-origin relative URLs get the token.
   */
  apiBaseUrl?: string;
  /** Extra URL prefixes that may receive the bearer token. */
  tokenAllowlist?: readonly string[];
  /** Route of the login page (default `/login`). */
  loginPath?: string;
  /** Route shown to authenticated users lacking a role (default `/forbidden`). */
  forbiddenPath?: string;
}

export const AUTH_CONFIG = new InjectionToken<AuthConfig>(
  '@codify/auth/CONFIG',
  {
    providedIn: 'root',
    factory: () => ({}),
  },
);

/** Subset of @clerk/clerk-js's `Clerk` that AuthService relies on. */
export interface ClerkLike {
  load(options?: Record<string, unknown>): Promise<void>;
  readonly user:
    | {
        id: string;
        imageUrl?: string | null;
        fullName?: string | null;
        primaryEmailAddress?: { emailAddress: string } | null;
      }
    | null
    | undefined;
  readonly session: { getToken(): Promise<string | null> } | null | undefined;
  addListener(
    listener: (resources: { user?: unknown; session?: unknown }) => void,
  ): () => void;
  mountSignIn(node: HTMLDivElement, props?: Record<string, unknown>): void;
  unmountSignIn(node: HTMLDivElement): void;
  signOut(): Promise<void>;
  openUserProfile(props?: Record<string, unknown>): void;
}

export type ClerkLoader = (publishableKey: string) => Promise<ClerkLike>;

/** Lazy-load @clerk/clerk-js so the dev build never pays for it. */
export const defaultClerkLoader: ClerkLoader = async (publishableKey) => {
  const { Clerk } = await import('@clerk/clerk-js');
  return new Clerk(publishableKey) as unknown as ClerkLike;
};

export const CLERK_LOADER = new InjectionToken<ClerkLoader>(
  '@codify/auth/CLERK_LOADER',
  {
    providedIn: 'root',
    factory: () => defaultClerkLoader,
  },
);

/**
 * Sanitise a post-login redirect target: only in-app absolute paths
 * (`/today?x=1`), never `//evil.com`, `https://…` or `javascript:`.
 */
export function safeRedirect(
  target: string | null | undefined,
  fallback: string,
): string {
  if (
    !target ||
    !target.startsWith('/') ||
    target.startsWith('//') ||
    target.startsWith('/\\')
  ) {
    return fallback;
  }
  return target;
}

/** True when `url` may carry the bearer token under `config`. */
export function isTokenAllowed(url: string, config: AuthConfig): boolean {
  const prefixes = [config.apiBaseUrl, ...(config.tokenAllowlist ?? [])].filter(
    (p): p is string => !!p,
  );
  if (prefixes.length === 0) {
    // Not configured: same-origin relative URLs only.
    return url.startsWith('/') && !url.startsWith('//');
  }
  return prefixes.some((prefix) => {
    const base = prefix.replace(/\/+$/, '');
    return (
      url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`)
    );
  });
}
