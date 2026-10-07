import { TestBed } from '@angular/core/testing';
import {
  REWARD_COLLAPSE_WINDOW_MS,
  RewardOrchestrator,
  collapse,
  multiplierParts,
} from './reward-orchestrator.service.js';
import { XpService } from './state/xp.service.js';
import { CoinService } from './state/coin.service.js';
import { StreakService } from './state/streak.service.js';
import { MotionAndSoundService } from './motion-and-sound.service.js';
import { HapticsService } from './haptics.service.js';
import { SoundService } from './sound.service.js';
import { OverlayHostService } from './overlay/overlay-host.service.js';
import * as coinFlyModule from './animation/coin-fly.directive.js';
import type { RewardGrantResult, RewardPayload } from './types.js';

describe('RewardOrchestrator', () => {
  let orchestrator: RewardOrchestrator;
  let xp: XpService;
  let coins: CoinService;
  let streaks: StreakService;
  let motion: MotionAndSoundService;
  let haptics: HapticsService;
  let overlays: OverlayHostService;

  const lesson = (
    xpv: number,
    coinsv = 0,
    extra: Partial<RewardPayload> = {},
  ): RewardPayload => ({
    kind: 'lessonComplete',
    canonical: { xp: xpv, coins: coinsv },
    ...extra,
  });

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    TestBed.configureTestingModule({});
    orchestrator = TestBed.inject(RewardOrchestrator);
    xp = TestBed.inject(XpService);
    coins = TestBed.inject(CoinService);
    streaks = TestBed.inject(StreakService);
    motion = TestBed.inject(MotionAndSoundService);
    haptics = TestBed.inject(HapticsService);
    overlays = TestBed.inject(OverlayHostService);
    motion.setMotionPref('on');
    jest.spyOn(haptics, 'impact').mockResolvedValue(undefined);
    jest
      .spyOn(TestBed.inject(SoundService), 'play')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  /** Advance fake time in small steps so rAF tweens + promises progress. */
  async function advance(ms: number, step = 16): Promise<void> {
    for (let t = 0; t < ms; t += step) {
      await jest.advanceTimersByTimeAsync(Math.min(step, ms - t));
    }
  }

  async function settle<T>(p: Promise<T>): Promise<T> {
    let done = false;
    let value!: T;
    void p.then((v) => {
      done = true;
      value = v;
    });
    for (let i = 0; i < 400 && !done; i++)
      await jest.advanceTimersByTimeAsync(16);
    if (!done) throw new Error('promise did not settle');
    return value;
  }

  describe('reconcile', () => {
    it('snaps actual AND displayed, also when they were already non-zero', () => {
      orchestrator.reconcile({
        totalXp: 100,
        coins: 50,
        streakDays: 3,
        freezesAvailable: 1,
        bestDays: 9,
      });
      expect([
        xp.actual(),
        xp.displayed(),
        coins.actual(),
        coins.displayed(),
      ]).toEqual([100, 100, 50, 50]);
      orchestrator.reconcile({ totalXp: 250, coins: 10 });
      expect(xp.displayed()).toBe(250);
      expect(coins.displayed()).toBe(10);
      expect(streaks.currentDays()).toBe(3);
      expect(streaks.freezesAvailable()).toBe(1);
      expect(streaks.bestDays()).toBe(9);
    });
  });

  describe('collapse window', () => {
    it('collapses grants inside the window into ONE run with summed deltas', async () => {
      orchestrator.reconcile({ totalXp: 0, coins: 0 });
      const a = orchestrator.grant(lesson(10, 5));
      await advance(500);
      const b = orchestrator.grant(lesson(20, 7));
      const [ra, rb] = await settle(Promise.all([a, b]));
      expect(ra).toBe(rb);
      expect(ra.toast.xp).toBe(30);
      expect(ra.toast.coins).toBe(12);
      expect(xp.actual()).toBe(30);
      expect(coins.actual()).toBe(12);
      expect(haptics.impact).toHaveBeenCalledTimes(1);
    });

    it('opens at the FIRST event — a later grant does not postpone the flush', async () => {
      orchestrator.reconcile({ totalXp: 0, coins: 0 });
      const results: RewardGrantResult[] = [];
      void orchestrator.grant(lesson(10)).then((r) => results.push(r));
      await advance(700);
      void orchestrator.grant(lesson(20)).then((r) => results.push(r));
      await advance(300); // t = 1000ms: first window (0–800) has flushed
      void orchestrator.grant(lesson(40)).then((r) => results.push(r));
      expect(haptics.impact).toHaveBeenCalledTimes(1);
      expect(xp.actual()).toBe(30); // first cluster (10 + 20) is already running
      await advance(2000);
      expect(results.map((r) => r.toast.xp)).toEqual([30, 30, 40]);
      expect(xp.actual()).toBe(70);
    });

    it('does not run anything before the window closes', async () => {
      void orchestrator.grant(lesson(10));
      await advance(REWARD_COLLAPSE_WINDOW_MS - 20);
      expect(haptics.impact).not.toHaveBeenCalled();
      expect(xp.actual()).toBe(0);
    });

    it('flushNow() closes the window immediately', async () => {
      const p = orchestrator.grant(lesson(10));
      orchestrator.flushNow();
      await advance(1);
      expect(haptics.impact).toHaveBeenCalledTimes(1);
      await settle(p);
    });
  });

  describe('counter tween', () => {
    it('tweens the very first reward from 0 instead of snapping', async () => {
      const p = orchestrator.grant(lesson(100, 20));
      await advance(REWARD_COLLAPSE_WINDOW_MS + 50 + 200);
      const mid = xp.displayed();
      expect(xp.actual()).toBe(100);
      expect(mid).toBeGreaterThan(0);
      expect(mid).toBeLessThan(100);
      await settle(p);
      expect(xp.displayed()).toBe(100);
      expect(coins.displayed()).toBe(20);
    });

    it('rolls up from the previous displayed value after a reconcile', async () => {
      orchestrator.reconcile({ totalXp: 1000, coins: 0 });
      const seen: number[] = [];
      const p = orchestrator.grant(lesson(100));
      for (let i = 0; i < 80; i++) {
        await jest.advanceTimersByTimeAsync(16);
        seen.push(xp.displayed());
      }
      await settle(p);
      expect(seen.some((v) => v > 1000 && v < 1100)).toBe(true);
      expect(Math.min(...seen)).toBe(1000);
      expect(xp.displayed()).toBe(1100);
    });
  });

  describe('canonical totals', () => {
    it('uses server totals instead of actual + delta', async () => {
      orchestrator.reconcile({ totalXp: 1000, coins: 100 });
      const r = await settle(
        orchestrator.grant(
          lesson(10, 5, {
            totals: { totalXp: 2000, coins: 400, streakDays: 7 },
          }),
        ),
      );
      expect(r.totals).toEqual({ totalXp: 2000, coins: 400 });
      expect(xp.actual()).toBe(2000);
      expect(xp.displayed()).toBe(2000);
      expect(coins.displayed()).toBe(400);
      expect(streaks.currentDays()).toBe(7);
      // Toast still shows the deltas the user earned.
      expect(r.toast.xp).toBe(10);
    });

    it('takes the latest snapshot when several payloads collapse', () => {
      const c = collapse([
        lesson(10, 0, {
          totals: { totalXp: 510 },
          serverTimestamp: '2026-10-07T10:00:02Z',
        }),
        lesson(10, 0, {
          totals: { totalXp: 500, coins: 9 },
          serverTimestamp: '2026-10-07T10:00:01Z',
        }),
      ]);
      expect(c.totals).toEqual({ totalXp: 510, coins: 9 });
      const byOrder = collapse([
        lesson(1, 0, { totals: { totalXp: 1 } }),
        lesson(1, 0, { totals: { totalXp: 2 } }),
      ]);
      expect(byOrder.totals?.totalXp).toBe(2);
    });
  });

  describe('toast', () => {
    it('emits the multiplier breakdown text', async () => {
      const r = await settle(
        orchestrator.grant({
          kind: 'quizPass',
          canonical: {
            xp: 240,
            coins: 0,
            multiplier: 2.4,
            breakdown: [
              { source: 'base', xp: 100, coins: 0 },
              { source: 'PREMIUM_DEFAULT', multiplier: 2 },
              { source: 'STREAK_TIER', multiplier: 1.2 },
            ],
          },
        }),
      );
      expect(r.toast.text).toBe('+240 XP (×2 premium × 1.2 streak)');
      expect(orchestrator.toast()).toBe(r.toast);
      expect(r.toast.parts.map((p) => p.labelKey)).toEqual([
        'gamification.multiplier.premium',
        'gamification.multiplier.streakTier',
      ]);
    });

    it('formats coins and unknown sources', () => {
      expect(
        multiplierParts([{ source: 'weekend-multiplier', multiplier: 1.5 }])[0]
          .label,
      ).toBe('weekend');
      expect(multiplierParts([{ source: 'X', multiplier: 1 }])).toEqual([]);
    });
  });

  describe('overlays', () => {
    it('grant() resolves before the level-up overlay is dismissed', async () => {
      const r = await settle(
        orchestrator.grant(lesson(50, 0, { levelUp: { newLevel: 3 } })),
      );
      expect(xp.displayed()).toBe(50);
      expect(overlays.current()).toEqual({
        kind: 'level-up',
        info: { newLevel: 3 },
      });
      let overlaysDone = false;
      void r.overlays.then(() => (overlaysDone = true));
      await advance(50);
      expect(overlaysDone).toBe(false);
      overlays.dismiss();
      await advance(16);
      expect(overlaysDone).toBe(true);
    });

    it('queues badge overlays after the level-up', async () => {
      const r = await settle(
        orchestrator.grant(
          lesson(5, 0, {
            levelUp: { newLevel: 2 },
            badgesUnlocked: [{ id: 'b1', name: 'First steps', icon: 'trophy' }],
          }),
        ),
      );
      expect(overlays.current()?.kind).toBe('level-up');
      overlays.dismiss();
      await advance(16);
      expect(overlays.current()).toEqual({
        kind: 'badge-unlock',
        badge: { id: 'b1', name: 'First steps', icon: 'trophy' },
      });
      overlays.dismiss();
      await settle(r.overlays);
      expect(overlays.current()).toBeNull();
    });
  });

  describe('reduced motion', () => {
    it('skips overlays + coin-fly and puts level-up/badge into the toast', async () => {
      motion.setMotionPref('off');
      const fly = jest.spyOn(coinFlyModule, 'coinFly');
      const source = document.createElement('button');
      const r = await settle(
        orchestrator.grant(
          lesson(30, 10, {
            sourceEl: source,
            levelUp: { newLevel: 4 },
            badgesUnlocked: [
              { id: 'b', name: 'Quick learner', icon: 'trophy' },
            ],
          }),
        ),
      );
      expect(overlays.current()).toBeNull();
      expect(fly).not.toHaveBeenCalled();
      expect(r.toast.replacesOverlays).toBe(true);
      expect(r.toast.text).toBe(
        '+30 XP · +10 coins · Level 4! · Badge unlocked: Quick learner',
      );
      expect(xp.displayed()).toBe(30);
    });

    it('uses the short tween when motion is reduced', async () => {
      motion.setMotionPref('off');
      const tween = jest.spyOn(xp, 'tweenTo');
      await settle(orchestrator.grant(lesson(10)));
      expect(tween).toHaveBeenCalledWith(10, 200);
    });

    it('plays coin-fly with the seeded RNG when motion is allowed', async () => {
      const fly = jest
        .spyOn(coinFlyModule, 'coinFly')
        .mockResolvedValue(undefined);
      orchestrator.useSeed(42);
      const source = document.createElement('button');
      await settle(orchestrator.grant(lesson(10, 25, { sourceEl: source })));
      expect(fly).toHaveBeenCalledWith(source, 5, { seed: 42 });
    });
  });

  describe('resilience', () => {
    it('a failing run does not wedge the queue and still lands on the totals', async () => {
      const warn = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      jest.spyOn(xp, 'tweenTo').mockRejectedValueOnce(new Error('boom'));
      const first = await settle(orchestrator.grant(lesson(10)));
      expect(first.totals.totalXp).toBe(10);
      expect(xp.displayed()).toBe(10);
      expect(warn).toHaveBeenCalled();
      const second = await settle(orchestrator.grant(lesson(5)));
      expect(second.totals.totalXp).toBe(15);
      expect(xp.displayed()).toBe(15);
    });
  });
});
