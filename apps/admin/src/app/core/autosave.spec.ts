import { AUTOSAVE_DELAY_MS, Autosave, formatClockTime } from './autosave';

describe('Autosave', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function setup(opts: { valid?: boolean; saving?: boolean } = {}) {
    const state = { valid: opts.valid ?? true, saving: opts.saving ?? false };
    const save = jest.fn(async () => undefined);
    const auto = new Autosave({
      canSave: () => state.valid,
      isSaving: () => state.saving,
      save,
    });
    return { auto, save, state };
  }

  it('saves once, 5 s after the last change', async () => {
    const { auto, save } = setup();
    auto.changed();
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1000);
    auto.changed();
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    expect(auto.pending).toBe(false);
  });

  it('does not autosave while invalid', async () => {
    const { auto, save } = setup({ valid: false });
    auto.changed();
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await Promise.resolve();
    expect(save).not.toHaveBeenCalled();
  });

  it('waits for an in-flight save, then retries', async () => {
    const { auto, save, state } = setup({ saving: true });
    auto.changed();
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await Promise.resolve();
    expect(save).not.toHaveBeenCalled();
    expect(auto.pending).toBe(true);
    state.saving = false;
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('tracks revisions so edits during a save are not lost', () => {
    const { auto } = setup();
    auto.changed();
    const rev = auto.revision;
    expect(auto.isCurrent(rev)).toBe(true);
    auto.changed();
    expect(auto.isCurrent(rev)).toBe(false);
  });

  it('cancel stops a pending save', async () => {
    const { auto, save } = setup();
    auto.changed();
    auto.cancel();
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await Promise.resolve();
    expect(save).not.toHaveBeenCalled();
  });
});

describe('formatClockTime', () => {
  it('includes seconds in the given locale', () => {
    const d = new Date(2026, 10, 7, 14, 5, 9);
    expect(formatClockTime(d, 'pt-BR')).toBe('14:05:09');
    expect(formatClockTime(d, 'en-US')).toMatch(/02:05:09\s?PM/);
  });
});
