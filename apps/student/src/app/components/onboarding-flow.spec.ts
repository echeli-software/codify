import {
  DEFAULT_REMINDER_MINUTE,
  asOnboardingGoal,
  firstLessonRoute,
  minuteToTime,
  readGoalRecord,
  resolveOnboardingGoal,
  timeToMinute,
} from './onboarding-flow.component';

describe('onboarding schedule helpers', () => {
  it('defaults to 8 PM and round-trips HH:MM', () => {
    expect(minuteToTime(DEFAULT_REMINDER_MINUTE)).toBe('20:00');
    expect(minuteToTime(7 * 60 + 5)).toBe('07:05');
    expect(timeToMinute('07:05')).toBe(425);
    expect(timeToMinute(' 23:59 ')).toBe(1439);
    expect(timeToMinute('24:00')).toBeNull();
    expect(timeToMinute('7pm')).toBeNull();
  });
});

describe('firstLessonRoute (docs/05 onboarding step 5)', () => {
  const lesson = (id: string, order: number, isFree: boolean) => ({
    id,
    order,
    isFree,
    type: 'READING' as const,
    estimatedMinutes: 3,
    title: id,
  });
  const course = { id: 'c1', slug: 'js' };

  it('launches the first free lesson in curriculum order', async () => {
    const courses = {
      detail: jest.fn(async () => ({
        modules: [
          { id: 'm2', order: 2, title: 'B', lessons: [lesson('l3', 1, true)] },
          {
            id: 'm1',
            order: 1,
            title: 'A',
            lessons: [lesson('l2', 2, true), lesson('l1', 1, false)],
          },
        ],
      })),
    };
    await expect(firstLessonRoute(courses as never, course)).resolves.toEqual([
      '/lessons',
      'l2',
    ]);
  });

  it('falls back to the first lesson, then the course page', async () => {
    const one = {
      detail: jest.fn(async () => ({
        modules: [
          { id: 'm1', order: 1, title: 'A', lessons: [lesson('l1', 1, false)] },
        ],
      })),
    };
    await expect(firstLessonRoute(one as never, course)).resolves.toEqual([
      '/lessons',
      'l1',
    ]);
    const none = { detail: jest.fn(async () => ({ modules: [] })) };
    await expect(firstLessonRoute(none as never, course)).resolves.toEqual([
      '/courses',
      'js',
    ]);
    const failing = {
      detail: jest.fn(async () => {
        throw new Error('offline');
      }),
    };
    await expect(firstLessonRoute(failing as never, course)).resolves.toEqual([
      '/courses',
      'js',
    ]);
  });
});

describe('onboarding goal on the account (LRN-10)', () => {
  it('accepts only the four goals', () => {
    expect(asOnboardingGoal('ai')).toBe('ai');
    expect(asOnboardingGoal('softSkills')).toBe('softSkills');
    expect(asOnboardingGoal('money')).toBeNull();
    expect(asOnboardingGoal(null)).toBeNull();
  });

  it('parses the device record, tolerating junk', () => {
    expect(readGoalRecord('{"goal":"career","at":"x"}')).toEqual({
      goal: 'career',
      synced: false,
    });
    expect(readGoalRecord('{"goal":"ai","synced":true}')).toEqual({
      goal: 'ai',
      synced: true,
    });
    expect(readGoalRecord('{"goal":"nope"}')).toEqual({
      goal: null,
      synced: false,
    });
    expect(readGoalRecord('not json')).toEqual({ goal: null, synced: false });
    expect(readGoalRecord(null)).toEqual({ goal: null, synced: false });
  });

  it('the account goal wins over the device one', () => {
    expect(
      resolveOnboardingGoal(
        { onboardingGoal: 'ai' },
        { goal: 'career', synced: false },
      ),
    ).toEqual({ goal: 'ai', migrate: false });
  });

  it('falls back to the device goal and migrates it up once', () => {
    expect(
      resolveOnboardingGoal(
        { onboardingGoal: null },
        { goal: 'career', synced: false },
      ),
    ).toEqual({ goal: 'career', migrate: true });
    // Already sent once (e.g. cleared on the account since): fall back only.
    expect(
      resolveOnboardingGoal(
        { onboardingGoal: null },
        { goal: 'career', synced: true },
      ),
    ).toEqual({ goal: 'career', migrate: false });
    expect(
      resolveOnboardingGoal(
        { onboardingGoal: null },
        { goal: null, synced: false },
      ),
    ).toEqual({ goal: null, migrate: false });
  });

  it('never migrates when the account state is unknown', () => {
    const local = { goal: 'newTech' as const, synced: false };
    // Offline / failed GET /me.
    expect(resolveOnboardingGoal(null, local)).toEqual({
      goal: 'newTech',
      migrate: false,
    });
    // Older API without the field.
    expect(resolveOnboardingGoal({}, local)).toEqual({
      goal: 'newTech',
      migrate: false,
    });
  });
});
