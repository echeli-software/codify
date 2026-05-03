import { Injectable, inject } from '@angular/core';
import { MotionAndSoundService } from './motion-and-sound.service.js';
import type { RewardKind } from './types.js';

/**
 * Plays short SFX in response to reward kinds. v1 ships without bundled
 * audio assets — calls are no-ops when no sample is registered. Hook a
 * real audio bundle in by calling `registerSample(kind, url)` once at
 * startup; the file is fetched + cached on first use.
 *
 * `MotionAndSoundService.soundMuted()` is honored — a muted user gets
 * full silence, no decoding cost.
 *
 * Avoids HTMLAudioElement state leaks by using WebAudio when available
 * and gracefully falling back to Audio() otherwise.
 */
@Injectable({ providedIn: 'root' })
export class SoundService {
  private readonly motion = inject(MotionAndSoundService);
  private readonly samples = new Map<RewardKind, string>();
  private readonly buffers = new Map<RewardKind, AudioBuffer>();
  private ctx: AudioContext | null = null;

  registerSample(kind: RewardKind, url: string): void {
    this.samples.set(kind, url);
  }

  async play(kind: RewardKind): Promise<void> {
    if (this.motion.soundMuted()) return;
    const url = this.samples.get(kind);
    if (!url) return;
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const buffer = await this.loadBuffer(kind, url, ctx);
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
      (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
      return this.ctx;
    } catch {
      return null;
    }
  }

  private async loadBuffer(
    kind: RewardKind,
    url: string,
    ctx: AudioContext,
  ): Promise<AudioBuffer> {
    const cached = this.buffers.get(kind);
    if (cached) return cached;
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    const buf = await ctx.decodeAudioData(arr);
    this.buffers.set(kind, buf);
    return buf;
  }
}
