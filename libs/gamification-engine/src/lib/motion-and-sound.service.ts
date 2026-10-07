import { Injectable, signal, computed, type Signal } from '@angular/core';

const MOTION_KEY = 'codify.motion';
const SOUND_KEY = 'codify.sound';

export type MotionSoundPref = 'on' | 'off' | 'system';
type Pref = MotionSoundPref;

/**
 * Single source of truth for "should we animate" and "should we play sound".
 * Reads `prefers-reduced-motion` from the OS, layers the user's per-account
 * toggle on top, and exposes both as signals so `RewardOrchestrator` can
 * branch declaratively.
 *
 * Persists user choice in `localStorage` so it survives reloads. Both prefs
 * default to `'system'` (which means: follow the OS for motion, default-on
 * for sound).
 *
 * SSR-safe: gracefully degrades when `window`/`matchMedia` are missing.
 */
@Injectable({ providedIn: 'root' })
export class MotionAndSoundService {
  private readonly motionPrefSig = signal<Pref>(
    this.readPref(MOTION_KEY) ?? 'system',
  );
  private readonly soundPrefSig = signal<Pref>(
    this.readPref(SOUND_KEY) ?? 'system',
  );
  private readonly osPrefersReducedMotion = signal(this.readOsReducedMotion());

  /** True when animations should be skipped or simplified. */
  readonly reducedMotion: Signal<boolean> = computed(() => {
    const p = this.motionPrefSig();
    if (p === 'off') return true;
    if (p === 'on') return false;
    return this.osPrefersReducedMotion();
  });

  /** True when sound should NOT play. */
  readonly soundMuted: Signal<boolean> = computed(
    () => this.soundPrefSig() === 'off',
  );

  constructor() {
    this.bindOsMediaQuery();
  }

  setMotionPref(pref: Pref): void {
    this.motionPrefSig.set(pref);
    this.writePref(MOTION_KEY, pref);
  }

  setSoundPref(pref: Pref): void {
    this.soundPrefSig.set(pref);
    this.writePref(SOUND_KEY, pref);
  }

  motionPref(): Pref {
    return this.motionPrefSig();
  }

  soundPref(): Pref {
    return this.soundPrefSig();
  }

  private readOsReducedMotion(): boolean {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    )
      return false;
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  private bindOsMediaQuery(): void {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    )
      return;
    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      const handler = (e: MediaQueryListEvent) =>
        this.osPrefersReducedMotion.set(e.matches);
      // addEventListener is the modern API; older Safari needs addListener.
      if ('addEventListener' in mq) {
        mq.addEventListener('change', handler);
      } else {
        (
          mq as unknown as { addListener: (h: typeof handler) => void }
        ).addListener(handler);
      }
    } catch {
      /* no-op */
    }
  }

  private readPref(key: string): Pref | null {
    try {
      const v = localStorage.getItem(key);
      return v === 'on' || v === 'off' || v === 'system' ? v : null;
    } catch {
      return null;
    }
  }

  private writePref(key: string, pref: Pref): void {
    try {
      localStorage.setItem(key, pref);
    } catch {
      /* private mode — ignore */
    }
  }
}
