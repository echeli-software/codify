import { TestBed } from '@angular/core/testing';
import { planConfetti, confettiBurst } from './animation/confetti.js';
import { planCoinFly } from './animation/coin-fly.directive.js';
import { HAPTICS_ADAPTER, HapticsService } from './haptics.service.js';
import { MotionAndSoundService } from './motion-and-sound.service.js';
import { SOUND_CUES, SoundService, cueDuration } from './sound.service.js';
import { QuestService } from './state/quest.service.js';
import { LeagueService, zoneForRank } from './state/league.service.js';
import { OverlayHostService } from './overlay/overlay-host.service.js';

describe('seeded animation plans', () => {
  it('confetti is identical for the same seed and differs across seeds', () => {
    const a = planConfetti({ seed: 7, count: 20 });
    const b = planConfetti({ seed: 7, count: 20 });
    const c = planConfetti({ seed: 8, count: 20 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).toHaveLength(20);
  });
  it('coin trail is identical for the same seed', () => {
    expect(planCoinFly(5, { seed: 1 })).toEqual(planCoinFly(5, { seed: 1 }));
    expect(planCoinFly(5, { seed: 1 })).not.toEqual(
      planCoinFly(5, { seed: 2 }),
    );
    expect(planCoinFly(3).map((p) => p.delayMs)).toEqual([0, 40, 80]);
  });
  it('confettiBurst cleans up its particles (no WAAPI in jsdom)', async () => {
    await confettiBurst({ x: 10, y: 10, count: 4, seed: 1 });
    expect(
      document.getElementById('cdf-confetti-layer')?.childElementCount,
    ).toBe(0);
  });
});

describe('SoundService', () => {
  class FakeParam {
    setValueAtTime = jest.fn();
    exponentialRampToValueAtTime = jest.fn();
  }
  class FakeCtx {
    static instances = 0;
    currentTime = 0;
    state = 'running';
    destination = {};
    oscillators = 0;
    constructor() {
      FakeCtx.instances++;
    }
    createOscillator() {
      this.oscillators++;
      return {
        type: '',
        frequency: new FakeParam(),
        connect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
      };
    }
    createGain() {
      return { gain: new FakeParam(), connect: jest.fn() };
    }
    resume() {
      return Promise.resolve();
    }
  }

  beforeEach(() => {
    localStorage.clear();
    FakeCtx.instances = 0;
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
    TestBed.configureTestingModule({});
  });
  afterEach(() => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    TestBed.resetTestingModule();
  });

  it('synthesizes the mapped cue with oscillators (no assets)', async () => {
    const sound = TestBed.inject(SoundService);
    await sound.play('levelUp');
    const ctx = (sound as unknown as { ctx: FakeCtx }).ctx;
    expect(ctx.oscillators).toBe(SOUND_CUES.levelUp.length);
  });

  it('setSoundEnabled(false) silences and persists; no AudioContext is created', async () => {
    const sound = TestBed.inject(SoundService);
    sound.setSoundEnabled(false);
    expect(sound.soundEnabled()).toBe(false);
    expect(localStorage.getItem('codify.sound')).toBe('off');
    await sound.play('lessonComplete');
    sound.playCue('wrong');
    expect(FakeCtx.instances).toBe(0);
    sound.setSoundEnabled(true);
    expect(TestBed.inject(MotionAndSoundService).soundPref()).toBe('on');
  });

  it('cue lengths match docs/10 §4', () => {
    expect(cueDuration('reward')).toBeCloseTo(0.4, 1);
    expect(cueDuration('levelUp')).toBeCloseTo(1.2, 1);
    expect(cueDuration('badge')).toBeCloseTo(0.6, 1);
    expect(cueDuration('wrong')).toBeCloseTo(0.2, 1);
  });
});

describe('HapticsService', () => {
  afterEach(() => {
    delete (globalThis as { Capacitor?: unknown }).Capacitor;
    TestBed.resetTestingModule();
  });

  it('prefers an injected adapter', async () => {
    const impact = jest.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: HAPTICS_ADAPTER, useValue: { impact } }],
    });
    await TestBed.inject(HapticsService).impact('heavy');
    expect(impact).toHaveBeenCalledWith('heavy');
  });

  it('uses the Capacitor bridge plugin on native without importing anything', async () => {
    const impact = jest.fn().mockResolvedValue(undefined);
    (globalThis as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      Plugins: { Haptics: { impact } },
    };
    TestBed.configureTestingModule({});
    await TestBed.inject(HapticsService).impact('light');
    expect(impact).toHaveBeenCalledWith({ style: 'LIGHT' });
  });

  it('falls back to navigator.vibrate and never throws', async () => {
    const vibrate = jest.fn();
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrate,
      configurable: true,
    });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: HAPTICS_ADAPTER,
          useValue: { impact: () => Promise.reject(new Error('x')) },
        },
      ],
    });
    await TestBed.inject(HapticsService).impact('medium');
    expect(vibrate).toHaveBeenCalledWith(20);
  });
});

describe('QuestService', () => {
  beforeEach(() => TestBed.configureTestingModule({}));
  afterEach(() => TestBed.resetTestingModule());
  const q = (id: string, progress: number, target = 3) => ({
    id,
    kind: 'LESSONS',
    title: id,
    target,
    progress,
    completed: false,
    xpReward: 10,
    coinReward: 5,
  });

  it('tracks progress and reports newly completed quests', () => {
    const quests = TestBed.inject(QuestService);
    quests.set([q('a', 1), q('b', 3), q('c', 0)]);
    expect(quests.completedCount()).toBe(1);
    expect(quests.progressPct()).toBe(44);
    const done = quests.applyProgress([
      { id: 'a', progress: 5 },
      { id: 'zzz', progress: 1 },
    ]);
    expect(done.map((d) => d.id)).toEqual(['a']);
    expect(quests.quests()[0].progress).toBe(3);
    expect(quests.allComplete()).toBe(false);
    quests.applyProgress([{ id: 'c', completed: true }]);
    expect(quests.allComplete()).toBe(true);
    quests.clear();
    expect(quests.progressPct()).toBe(0);
    expect(quests.allComplete()).toBe(false);
  });
});

describe('LeagueService', () => {
  beforeEach(() => TestBed.configureTestingModule({}));
  afterEach(() => TestBed.resetTestingModule());

  it('computes zones, sorts members and bumps my weekly XP', () => {
    const league = TestBed.inject(LeagueService);
    expect(league.myZone()).toBeNull();
    league.set({
      tier: 'SILVER',
      weekStart: '2026-10-05',
      resetAt: '2026-10-12',
      promoteCount: 2,
      demoteCount: 2,
      cohortSize: 6,
      myRank: 2,
      myWeeklyXp: 90,
      members: [
        {
          userId: 'u2',
          displayName: 'Me',
          weeklyXp: 90,
          level: 3,
          rank: 2,
          isMe: true,
        },
        {
          userId: 'u1',
          displayName: 'Ana',
          weeklyXp: 120,
          level: 4,
          rank: 1,
          isMe: false,
        },
      ],
    });
    expect(league.members().map((m) => m.userId)).toEqual(['u1', 'u2']);
    expect(league.myZone()).toBe('promote');
    league.addMyWeeklyXp(15);
    league.addMyWeeklyXp(-5);
    expect(league.me()?.weeklyXp).toBe(105);
    expect(league.league()?.myWeeklyXp).toBe(105);
  });

  it('zoneForRank', () => {
    expect(zoneForRank(1, 30, 5, 5)).toBe('promote');
    expect(zoneForRank(15, 30, 5, 5)).toBe('safe');
    expect(zoneForRank(26, 30, 5, 5)).toBe('demote');
    expect(zoneForRank(30, 30, 5, 0)).toBe('safe');
  });
});

describe('OverlayHostService', () => {
  beforeEach(() => TestBed.configureTestingModule({}));
  afterEach(() => TestBed.resetTestingModule());

  it('queues overlays and resolves each on its own dismissal', async () => {
    const host = TestBed.inject(OverlayHostService);
    const order: string[] = [];
    const a = host.showLevelUp({ newLevel: 2 }).then(() => order.push('a'));
    const b = host
      .showBadgeUnlock({ id: 'x', name: 'X', icon: 'trophy' })
      .then(() => order.push('b'));
    expect(host.current()?.kind).toBe('level-up');
    expect(host.queued).toBe(1);
    host.dismiss();
    await a;
    expect(host.current()?.kind).toBe('badge-unlock');
    host.clear();
    await b;
    expect(order).toEqual(['a', 'b']);
    expect(host.current()).toBeNull();
  });
});
