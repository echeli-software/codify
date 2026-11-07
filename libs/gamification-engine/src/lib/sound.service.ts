import { Injectable, computed, inject, type Signal } from '@angular/core';
import { MotionAndSoundService } from './motion-and-sound.service.js';
import type { RewardKind } from './types.js';

/** Cue families from docs/10 §4 "Sound design". */
export type SoundCue = 'reward' | 'levelUp' | 'badge' | 'wrong' | 'chest';

export interface SoundNote {
  /** Frequency in Hz. */
  freq: number;
  /** Start offset from the cue start, seconds. */
  at: number;
  /** Note length, seconds. */
  dur: number;
  type?: OscillatorType;
  /** Peak gain (0–1); kept low — "-8 LUFS-ish max". */
  gain?: number;
}

/**
 * Synthesized cues — no binary assets. Each is a handful of oscillator
 * notes with a fast attack / exponential release envelope.
 */
export const SOUND_CUES: Readonly<Record<SoundCue, readonly SoundNote[]>> = {
  // Rising arpeggio (~0.4s): C5 E5 G5 C6.
  reward: [
    { freq: 523.25, at: 0, dur: 0.12, type: 'triangle' },
    { freq: 659.25, at: 0.08, dur: 0.12, type: 'triangle' },
    { freq: 783.99, at: 0.16, dur: 0.12, type: 'triangle' },
    { freq: 1046.5, at: 0.24, dur: 0.16, type: 'triangle' },
  ],
  // Short fanfare (~1.2s).
  levelUp: [
    { freq: 392.0, at: 0, dur: 0.18, type: 'square', gain: 0.12 },
    { freq: 523.25, at: 0.18, dur: 0.18, type: 'square', gain: 0.12 },
    { freq: 659.25, at: 0.36, dur: 0.18, type: 'square', gain: 0.12 },
    { freq: 783.99, at: 0.54, dur: 0.3, type: 'square', gain: 0.12 },
    { freq: 1046.5, at: 0.84, dur: 0.36, type: 'triangle' },
  ],
  // Distinct chime (~0.6s): two bell-ish partials.
  badge: [
    { freq: 1318.5, at: 0, dur: 0.6, type: 'sine', gain: 0.18 },
    { freq: 1975.5, at: 0.05, dur: 0.5, type: 'sine', gain: 0.08 },
    { freq: 2637.0, at: 0.1, dur: 0.4, type: 'sine', gain: 0.05 },
  ],
  // Soft thud (~0.2s).
  wrong: [{ freq: 110, at: 0, dur: 0.2, type: 'sine', gain: 0.3 }],
  // Pop + sting.
  chest: [
    { freq: 220, at: 0, dur: 0.08, type: 'square', gain: 0.1 },
    { freq: 880, at: 0.1, dur: 0.25, type: 'triangle' },
    { freq: 1320, at: 0.18, dur: 0.3, type: 'triangle' },
  ],
};

export const CUE_FOR_KIND: Readonly<Record<RewardKind, SoundCue>> = {
  lessonComplete: 'reward',
  quizPass: 'reward',
  exercisePass: 'reward',
  aiPromptComplete: 'reward',
  scenarioComplete: 'reward',
  dailyQuestComplete: 'reward',
  streakMilestone: 'badge',
  levelUp: 'levelUp',
  badgeUnlock: 'badge',
  leaguePromotion: 'levelUp',
  mysteryChestOpen: 'chest',
};

/** Total length of a cue in seconds. */
export function cueDuration(cue: SoundCue): number {
  return Math.max(...SOUND_CUES[cue].map((n) => n.at + n.dur));
}

/**
 * Plays short SFX in response to reward kinds. Cues are synthesized with
 * WebAudio oscillators (no assets to download); a recorded sample can
 * still override a kind via `registerSample(kind, url)`.
 *
 * Honors the user's sound toggle (`soundEnabled` / `setSoundEnabled`,
 * persisted through `MotionAndSoundService`) — a muted user gets full
 * silence and no AudioContext is ever created.
 */
@Injectable({ providedIn: 'root' })
export class SoundService {
  private readonly prefs = inject(MotionAndSoundService);
  private readonly samples = new Map<RewardKind, string>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private ctx: AudioContext | null = null;

  /** False when the user muted SFX ("reduced sound"). */
  readonly soundEnabled: Signal<boolean> = computed(
    () => !this.prefs.soundMuted(),
  );

  /** Persisted on/off toggle for SFX (haptics are unaffected). */
  setSoundEnabled(enabled: boolean): void {
    this.prefs.setSoundPref(enabled ? 'on' : 'off');
  }

  registerSample(kind: RewardKind, url: string): void {
    this.samples.set(kind, url);
  }

  /** Play the cue mapped to a reward kind. */
  async play(kind: RewardKind): Promise<void> {
    if (!this.soundEnabled()) return;
    const url = this.samples.get(kind);
    if (url) {
      await this.playSample(url);
      return;
    }
    this.playCue(CUE_FOR_KIND[kind]);
  }

  /** Play a synthesized cue directly (e.g. 'wrong' on a failed quiz). */
  playCue(cue: SoundCue): void {
    if (!this.soundEnabled()) return;
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      const t0 = ctx.currentTime + 0.01;
      for (const note of SOUND_CUES[cue]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = note.type ?? 'sine';
        osc.frequency.setValueAtTime(note.freq, t0 + note.at);
        const peak = note.gain ?? 0.2;
        gain.gain.setValueAtTime(0.0001, t0 + note.at);
        gain.gain.exponentialRampToValueAtTime(peak, t0 + note.at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.at + note.dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0 + note.at);
        osc.stop(t0 + note.at + note.dur + 0.02);
      }
    } catch {
      /* SFX failure shouldn't bubble up to the user */
    }
  }

  private async playSample(url: string): Promise<void> {
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      let buffer = this.buffers.get(url);
      if (!buffer) {
        const res = await fetch(url);
        buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(url, buffer);
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
    } catch {
      /* SFX failure shouldn't bubble up to the user */
    }
  }

  private getContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    const Ctor =
      (window as unknown as { AudioContext?: typeof AudioContext })
        .AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
      return this.ctx;
    } catch {
      return null;
    }
  }
}
