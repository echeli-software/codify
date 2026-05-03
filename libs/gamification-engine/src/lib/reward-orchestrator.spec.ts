import { TestBed } from '@angular/core/testing';
import { RewardOrchestrator } from './reward-orchestrator.service.js';
import { XpService } from './state/xp.service.js';
import { CoinService } from './state/coin.service.js';

describe('RewardOrchestrator', () => {
  let orchestrator: RewardOrchestrator;
  let xp: XpService;
  let coins: CoinService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    orchestrator = TestBed.inject(RewardOrchestrator);
    xp = TestBed.inject(XpService);
    coins = TestBed.inject(CoinService);
  });

  it('reconciles canonical totals without animation', () => {
    orchestrator.reconcile({ totalXp: 100, coins: 50 });
    expect(xp.actual()).toBe(100);
    expect(coins.actual()).toBe(50);
    expect(xp.displayed()).toBe(100);
    expect(coins.displayed()).toBe(50);
  });

  it('collapses two grants within 800ms into one canonical update', async () => {
    orchestrator.reconcile({ totalXp: 0, coins: 0 });
    const a = orchestrator.grant({
      kind: 'lessonComplete',
      canonical: { xp: 10, coins: 5 },
    });
    const b = orchestrator.grant({
      kind: 'lessonComplete',
      canonical: { xp: 20, coins: 7 },
    });
    await Promise.all([a, b]);
    expect(xp.actual()).toBe(30);
    expect(coins.actual()).toBe(12);
  });

  it('grant() resolves once the visuals complete', async () => {
    orchestrator.reconcile({ totalXp: 0, coins: 0 });
    let resolved = false;
    const p = orchestrator
      .grant({ kind: 'lessonComplete', canonical: { xp: 5, coins: 1 } })
      .then(() => {
        resolved = true;
      });
    expect(resolved).toBe(false);
    await p;
    expect(resolved).toBe(true);
  });
});
