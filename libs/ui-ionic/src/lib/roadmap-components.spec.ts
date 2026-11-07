import {
  ElementRef,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18nService, provideI18n } from '@codify/i18n';
import {
  leaderboardZone,
  LeaderboardTable,
  type LeaderboardRow,
} from './organisms/leaderboard-table/leaderboard-table.js';
import { affordability } from './organisms/shop-grid/shop-item.js';
import { SAMPLE_ITEMS } from './organisms/shop-grid/sample-items.js';
import { groupBySlot, Inventory } from './organisms/inventory/inventory.js';
import { AvatarBuilder } from './organisms/avatar-builder/avatar-builder.js';
import { confettiPieces } from './organisms/celebration-overlay/celebration-overlay.js';
import {
  ScenarioRunner,
  stepScenario,
  type ScenarioGraphView,
} from './organisms/scenario-runner/scenario-runner.js';
import {
  AiPromptPlayground,
  rubricRows,
} from './organisms/ai-prompt-playground/ai-prompt-playground.js';
import { ExerciseRunner } from './organisms/exercise-runner/exercise-runner.js';
import { formatMinutes } from './molecules/course-card/course-card.js';
import { CoinCounter } from './molecules/coin-counter/coin-counter.js';
import { teardownOverlayOnDestroy } from './internal/overlay-teardown.js';

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), provideI18n()],
  });
  TestBed.inject(I18nService).setLocale('en-US');
});

const GRAPH: ScenarioGraphView = {
  startId: 'a',
  nodes: {
    a: {
      id: 'a',
      text: 'Hi',
      choices: [
        { id: 'c1', label: 'Go', to: 'b' },
        { id: 'c2', label: 'End', ending: true },
      ],
    },
    b: { id: 'b', text: 'Bye', choices: [] },
  },
};

describe('pure helpers', () => {
  it('leaderboardZone', () => {
    expect(leaderboardZone(1, 30, 5, 5)).toBe('promote');
    expect(leaderboardZone(10, 30, 5, 5)).toBe('safe');
    expect(leaderboardZone(30, 30, 5, 5)).toBe('demote');
  });

  it('affordability explains why an item cannot be bought', () => {
    const ctx = { balance: 100, level: 5, isPremium: false };
    const base = {
      ...SAMPLE_ITEMS[0],
      owned: false,
      isPremiumOnly: false,
      requiredLevel: 1,
      costCoins: 50,
    };
    expect(affordability({ ...base, owned: true }, ctx)).toBe('owned');
    expect(affordability({ ...base, isPremiumOnly: true }, ctx)).toBe(
      'premium',
    );
    expect(affordability({ ...base, requiredLevel: 9 }, ctx)).toBe('level');
    expect(affordability({ ...base, costCoins: 500 }, ctx)).toBe('short');
    expect(affordability(base, ctx)).toBe('ok');
  });

  it('groupBySlot follows the slot display order', () => {
    expect(
      groupBySlot(SAMPLE_ITEMS.filter((i) => i.owned)).map((g) => g.slot),
    ).toEqual(['HAT', 'TOP', 'BOTTOM', 'BACKGROUND']);
  });

  it('confettiPieces is deterministic per seed', () => {
    expect(confettiPieces(3, 10)).toEqual(confettiPieces(3, 10));
    expect(confettiPieces(3, 10)).not.toEqual(confettiPieces(4, 10));
  });

  it('stepScenario walks choices, endings and choiceless nodes', () => {
    expect(stepScenario(GRAPH, GRAPH.nodes['a'], 'c2')).toEqual({
      next: null,
      ended: true,
    });
    expect(stepScenario(GRAPH, GRAPH.nodes['a'], 'c1')).toEqual({
      next: GRAPH.nodes['b'],
      ended: true,
    });
  });

  it('rubricRows merges grading results into the rubric', () => {
    const prompt = {
      promptText: 'p',
      contextText: null,
      passThreshold: 70,
      maxAttempts: 3,
      attemptsUsed: 0,
      rubric: [
        { id: 'a', label: 'A', weight: 1 },
        { id: 'b', label: 'B', weight: 1 },
      ],
    };
    expect(
      rubricRows(prompt, [
        { id: 'a', label: 'A', weight: 1, passed: false, detail: 'x' },
      ]).map((r) => r.state),
    ).toEqual(['fail', 'idle']);
  });

  it('formatMinutes uses the duration keys', () => {
    const t = (k: string, p: Record<string, unknown>) =>
      `${k}:${JSON.stringify(p)}`;
    expect(formatMinutes(45, t)).toBe('ui.duration.minutes:{"m":45}');
    expect(formatMinutes(120, t)).toBe('ui.duration.hours:{"h":2}');
    expect(formatMinutes(150, t)).toBe(
      'ui.duration.hoursMinutes:{"h":2,"m":30}',
    );
    expect(formatMinutes(0, t)).toBe('');
  });
});

describe('LeaderboardTable', () => {
  it('pins me when I am below the visible window', async () => {
    const rows: LeaderboardRow[] = Array.from({ length: 20 }, (_, i) => ({
      userId: `u${i}`,
      displayName: `User ${i + 1}`,
      weeklyXp: 1000 - i,
      level: 3,
      rank: i + 1,
      isMe: i === 15,
    }));
    const f = TestBed.createComponent(LeaderboardTable);
    f.componentRef.setInput('rows', rows);
    f.componentRef.setInput('visibleRows', 5);
    f.componentRef.setInput('promoteCount', 3);
    await f.whenStable();
    const pinned = f.nativeElement.querySelector(
      '.cdf-board__pinned',
    ) as HTMLElement;
    expect(pinned.textContent).toContain('User 16');
    expect(pinned.textContent).toContain('Your position');
  });
});

describe('Inventory', () => {
  it('emits equip / unequip from aria-pressed toggles', async () => {
    const f = TestBed.createComponent(Inventory);
    f.componentRef.setInput(
      'items',
      SAMPLE_ITEMS.filter((i) => i.owned),
    );
    const events: string[] = [];
    f.componentInstance.equip.subscribe((i) => events.push(`equip:${i.id}`));
    f.componentInstance.unequip.subscribe((i) =>
      events.push(`unequip:${i.id}`),
    );
    await f.whenStable();
    const buttons = Array.from(
      f.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    const cap = buttons.find((b) => b.textContent?.includes('Cap'))!;
    const hoodie = buttons.find((b) => b.textContent?.includes('Hoodie'))!;
    expect(cap.getAttribute('aria-pressed')).toBe('true');
    cap.click();
    hoodie.click();
    expect(events).toEqual(['unequip:i2', 'equip:i4']);
  });
});

describe('AvatarBuilder', () => {
  it('previews picks locally and saves the full map', async () => {
    const f = TestBed.createComponent(AvatarBuilder);
    f.componentRef.setInput('items', SAMPLE_ITEMS);
    f.componentRef.setInput('equipped', { HAT: 'i2' });
    let saved: unknown = null;
    f.componentInstance.save.subscribe((m) => (saved = m));
    await f.whenStable();
    const radios = Array.from(
      f.nativeElement.querySelectorAll('[role="radio"]'),
    ) as HTMLButtonElement[];
    const wizard = radios.find((r) => r.textContent?.includes('Wizard hat'))!;
    wizard.click();
    await f.whenStable();
    expect(wizard.getAttribute('aria-checked')).toBe('true');
    expect(f.nativeElement.textContent).toContain('Unsaved changes');
    (f.nativeElement.querySelectorAll('cdf-app-button')[1] as HTMLElement)
      .querySelector('ion-button')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(saved).toEqual({ HAT: 'i1' });
  });
});

describe('ScenarioRunner', () => {
  it('emits the choice path when an ending is reached', async () => {
    const f = TestBed.createComponent(ScenarioRunner);
    f.componentRef.setInput('graph', GRAPH);
    let finished: { path: string[] } | null = null;
    f.componentInstance.finished.subscribe((e) => (finished = e));
    await f.whenStable();
    f.nativeElement
      .querySelector('ion-button')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await f.whenStable();
    expect(finished).toEqual(expect.objectContaining({ path: ['c1'] }));
    expect(f.nativeElement.textContent).toContain('Scenario complete');
  });
});

describe('AiPromptPlayground', () => {
  it('only enables submit once there is an answer and attempts remain', async () => {
    const f = TestBed.createComponent(AiPromptPlayground);
    f.componentRef.setInput('prompt', {
      promptText: 'P',
      contextText: null,
      passThreshold: 70,
      maxAttempts: 2,
      attemptsUsed: 2,
      rubric: [],
    });
    f.componentRef.setInput('response', 'hello world');
    await f.whenStable();
    expect(
      f.nativeElement.querySelector('ion-button')?.getAttribute('disabled'),
    ).not.toBeNull();
    expect(f.nativeElement.textContent).toContain('2 words');
  });
});

describe('ExerciseRunner', () => {
  it('labels the editor and summarises test results', async () => {
    const f = TestBed.createComponent(ExerciseRunner);
    f.componentRef.setInput('exercise', {
      language: 'javascript',
      entryFunction: 'sum',
      starterCode: '',
    });
    f.componentRef.setInput('results', [
      { id: 'a', name: 'one', passed: true },
      { id: 'b', name: 'two', passed: false, actual: 1, expected: 2 },
    ]);
    await f.whenStable();
    const editor = f.nativeElement.querySelector(
      'textarea',
    ) as HTMLTextAreaElement;
    expect(
      f.nativeElement.querySelector(`label[for="${editor.id}"]`)?.textContent,
    ).toContain('Your code');
    expect(f.nativeElement.textContent).toContain('1 of 2 tests passing');
    expect(f.nativeElement.textContent).toContain('got 1, expected 2');
  });
});

describe('CoinCounter', () => {
  it('snaps the first value and announces totals', async () => {
    const f = TestBed.createComponent(CoinCounter);
    f.componentRef.setInput('value', 1240);
    await f.whenStable();
    expect(
      f.nativeElement
        .querySelector('.cdf-coin-counter__value')
        .textContent.trim(),
    ).toBe('1,240');
    expect(
      f.nativeElement.querySelector('.cdf-coin-counter__live').textContent,
    ).toBe('1,240 coins');
  });
});

describe('teardownOverlayOnDestroy', () => {
  it('dismisses and detaches a re-parented overlay when its owner is destroyed', () => {
    const dismiss = jest.fn().mockResolvedValue(true);
    const overlay = Object.assign(document.createElement('div'), { dismiss });
    document.body.appendChild(overlay);
    const ref = signal<ElementRef<HTMLElement> | undefined>(
      new ElementRef(overlay),
    );
    TestBed.runInInjectionContext(() => teardownOverlayOnDestroy(ref));
    TestBed.resetTestingModule();
    expect(dismiss).toHaveBeenCalledWith(undefined, 'destroy');
    expect(overlay.isConnected).toBe(false);
  });
});
