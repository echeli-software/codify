import { Injectable, inject } from '@angular/core';
import {
  LeaguesClient,
  ProblemDetailsError,
  ReferralsClient,
} from '@codify/api-client';

/**
 * Pending growth links (docs/18): `/r/:code` (referral + friend invite) and
 * `/invite/:code` (friend invite only) can be opened before the visitor has
 * an account. The code is stored locally first, survives the sign-in /
 * sign-up round trip, and is claimed once an authenticated session exists.
 */
export type GrowthLinkKind = 'referral' | 'invite';

export type ReferralOutcome =
  | 'claimed'
  | 'already'
  | 'invalid'
  | 'ineligible'
  | 'conflict'
  | 'error';

export type InviteOutcome =
  | { status: 'accepted' | 'already_friends'; friendName: string }
  | { status: 'invalid' | 'self' | 'error' };

export interface GrowthClaimResult {
  referral: ReferralOutcome | null;
  invite: InviteOutcome | null;
}

const KEY: Record<GrowthLinkKind, string> = {
  referral: 'codify.pending.referral',
  invite: 'codify.pending.invite',
};
/** Pending codes older than this are dropped (the referral window is 14 d). */
const MAX_AGE_MS = 14 * 86_400_000;
const CODE_RE = /^[A-Za-z0-9_-]{3,64}$/;

interface Stored {
  code: string;
  at: number;
}

/** True when a code looks like one the API could have minted. */
export function isPlausibleCode(code: string | null | undefined): boolean {
  return !!code && CODE_RE.test(code);
}

/** Transient failures keep the code for a later retry; 4xx answers drop it. */
function isTransient(err: unknown): boolean {
  if (!(err instanceof ProblemDetailsError)) return true;
  return err.status === 0 || err.status === 401 || err.status >= 500;
}

export function referralOutcome(err: unknown): ReferralOutcome {
  if (!(err instanceof ProblemDetailsError)) return 'error';
  if (err.status === 404) return 'invalid';
  if (err.status === 409) return 'conflict';
  if (err.status === 400) return 'ineligible';
  return 'error';
}

export function inviteOutcome(err: unknown): InviteOutcome {
  if (err instanceof ProblemDetailsError) {
    if (err.status === 404) return { status: 'invalid' };
    if (err.status === 400) return { status: 'self' };
  }
  return { status: 'error' };
}

@Injectable({ providedIn: 'root' })
export class GrowthLinksService {
  private readonly referrals = inject(ReferralsClient);
  private readonly leagues = inject(LeaguesClient);

  remember(kind: GrowthLinkKind, code: string): void {
    if (!isPlausibleCode(code)) return;
    try {
      localStorage.setItem(
        KEY[kind],
        JSON.stringify({ code, at: Date.now() } satisfies Stored),
      );
    } catch {
      // Storage disabled (private mode): the in-URL code still works.
    }
  }

  pending(kind: GrowthLinkKind, now = Date.now()): string | null {
    try {
      const raw = localStorage.getItem(KEY[kind]);
      if (!raw) return null;
      const s = JSON.parse(raw) as Partial<Stored>;
      if (
        typeof s.code !== 'string' ||
        typeof s.at !== 'number' ||
        now - s.at > MAX_AGE_MS ||
        !isPlausibleCode(s.code)
      ) {
        this.forget(kind);
        return null;
      }
      return s.code;
    } catch {
      return null;
    }
  }

  forget(kind: GrowthLinkKind): void {
    try {
      localStorage.removeItem(KEY[kind]);
    } catch {
      // ignore
    }
  }

  hasPending(): boolean {
    return !!this.pending('referral') || !!this.pending('invite');
  }

  /**
   * Claim whatever is pending. Call only with an authenticated session.
   * Definitive answers (success or a 4xx) clear the stored code; network /
   * 5xx errors keep it so the next app start retries.
   */
  async claimPending(): Promise<GrowthClaimResult> {
    const result: GrowthClaimResult = { referral: null, invite: null };
    const refCode = this.pending('referral');
    if (refCode) {
      try {
        const r = await this.referrals.claim(refCode);
        result.referral = r.status === 'claimed' ? 'claimed' : 'already';
        this.forget('referral');
      } catch (err) {
        result.referral = referralOutcome(err);
        if (!isTransient(err)) this.forget('referral');
      }
    }
    const inviteCode = this.pending('invite');
    if (inviteCode) {
      try {
        const r = await this.leagues.acceptFriendInvite(inviteCode);
        result.invite = { status: r.status, friendName: r.friend.displayName };
        this.forget('invite');
      } catch (err) {
        result.invite = inviteOutcome(err);
        if (!isTransient(err)) this.forget('invite');
      }
    }
    return result;
  }
}
