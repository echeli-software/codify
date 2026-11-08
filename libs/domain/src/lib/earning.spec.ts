import {
  DEFAULT_EARNING_BY_TYPE,
  lessonBaseReward,
  splitCoinsByCap,
} from './earning.js';

describe('lessonBaseReward', () => {
  it('column defaults mean "use the per-type default"', () => {
    expect(
      lessonBaseReward({ type: 'QUIZ', baseXp: 10, baseCoins: 5 }),
    ).toEqual({ xp: 15, coins: 8 });
    expect(
      lessonBaseReward({ type: 'EXERCISE', baseXp: 10, baseCoins: 5 }),
    ).toEqual({ xp: 25, coins: 12 });
    expect(
      lessonBaseReward({ type: 'AI_PROMPT', baseXp: 10, baseCoins: 5 }),
    ).toEqual({ xp: 20, coins: 10 });
    expect(
      lessonBaseReward({ type: 'READING', baseXp: 10, baseCoins: 5 }),
    ).toEqual({ xp: 10, coins: 5 });
  });

  it('values an author changed win, per field', () => {
    expect(
      lessonBaseReward({ type: 'QUIZ', baseXp: 40, baseCoins: 5 }),
    ).toEqual({ xp: 40, coins: 8 });
    expect(
      lessonBaseReward({ type: 'QUIZ', baseXp: 10, baseCoins: 0 }),
    ).toEqual({ xp: 15, coins: 0 });
  });

  it('uses the configured table, and the docs table for missing types', () => {
    expect(
      lessonBaseReward(
        { type: 'QUIZ', baseXp: 10, baseCoins: 5 },
        { QUIZ: { xp: 30, coins: 1 } },
      ),
    ).toEqual({ xp: 30, coins: 1 });
    expect(
      lessonBaseReward({ type: 'SCENARIO', baseXp: 10, baseCoins: 5 }, {}),
    ).toEqual(DEFAULT_EARNING_BY_TYPE.SCENARIO);
    expect(
      lessonBaseReward({ type: 'UNKNOWN', baseXp: 10, baseCoins: 5 }, {}),
    ).toEqual({ xp: 10, coins: 5 });
  });
});

describe('splitCoinsByCap', () => {
  const base = { poolSoFar: 0, poolCap: 500 };
  it('uncapped sources pass through', () => {
    expect(
      splitCoinsByCap({
        ...base,
        amount: 50,
        earnedTodayFromSource: 999,
        dailyCap: null,
      }),
    ).toEqual({ granted: 50, pooled: 0, dropped: 0 });
  });

  it('under the cap everything is granted', () => {
    expect(
      splitCoinsByCap({
        ...base,
        amount: 50,
        earnedTodayFromSource: 100,
        dailyCap: 200,
      }),
    ).toEqual({ granted: 50, pooled: 0, dropped: 0 });
  });

  it('the part over the cap goes to the pool', () => {
    expect(
      splitCoinsByCap({
        ...base,
        amount: 50,
        earnedTodayFromSource: 180,
        dailyCap: 200,
      }),
    ).toEqual({ granted: 20, pooled: 30, dropped: 0 });
  });

  it('a full pool drops the rest', () => {
    expect(
      splitCoinsByCap({
        amount: 50,
        earnedTodayFromSource: 200,
        dailyCap: 200,
        poolSoFar: 480,
        poolCap: 500,
      }),
    ).toEqual({ granted: 0, pooled: 20, dropped: 30 });
  });

  it('non-positive amounts are untouched', () => {
    expect(
      splitCoinsByCap({
        ...base,
        amount: 0,
        earnedTodayFromSource: 999,
        dailyCap: 1,
      }),
    ).toEqual({ granted: 0, pooled: 0, dropped: 0 });
  });
});
