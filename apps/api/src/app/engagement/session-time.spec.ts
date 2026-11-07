import {
  DEFAULT_REMINDER_MINUTE,
  reminderMinuteFor,
  typicalSessionStart,
} from './session-time.js';
import { isDue } from './daily-quest-reminder.service.js';

/** `n` days of opens at local HH:MM São Paulo (UTC-3), plus noise later that day. */
function opens(days: number, hh: number, mm = 0): Date[] {
  const out: Date[] = [];
  for (let d = 0; d < days; d++) {
    const day = String(1 + d).padStart(2, '0');
    const utcH = String(hh + 3).padStart(2, '0');
    out.push(
      new Date(`2026-10-${day}T${utcH}:${String(mm).padStart(2, '0')}:00Z`),
    );
    out.push(new Date(`2026-10-${day}T23:30:00Z`)); // 20:30 local, later the same day
  }
  return out;
}

describe('typicalSessionStart', () => {
  it('needs 7 distinct local days of data', () => {
    expect(typicalSessionStart(opens(6, 9), 'America/Sao_Paulo')).toBeNull();
    expect(typicalSessionStart(opens(7, 9), 'America/Sao_Paulo')).toBe(9 * 60);
  });

  it('uses the first open per day and the median across days', () => {
    const data = [
      ...opens(4, 8),
      ...opens(3, 10).map((d) => new Date(d.getTime() + 4 * 86_400_000)),
    ];
    // first opens: 8,8,8,8,10,10,10 → median 8:00
    expect(typicalSessionStart(data, 'America/Sao_Paulo')).toBe(8 * 60);
  });

  it('works in the user timezone', () => {
    // 12:00Z every day = 09:00 São Paulo = 21:00 Tokyo.
    const noon = Array.from(
      { length: 7 },
      (_, d) => new Date(Date.UTC(2026, 9, 1 + d, 12, 0)),
    );
    expect(typicalSessionStart(noon, 'Asia/Tokyo')).toBe(21 * 60);
    expect(typicalSessionStart(noon, 'America/Sao_Paulo')).toBe(9 * 60);
  });
});

describe('reminderMinuteFor', () => {
  it('explicit > learned (+30 min) > 20:00 default', () => {
    expect(reminderMinuteFor(600, 480)).toEqual({
      minute: 600,
      source: 'explicit',
    });
    expect(reminderMinuteFor(0, null)).toEqual({
      minute: 0,
      source: 'explicit',
    });
    expect(reminderMinuteFor(null, 480)).toEqual({
      minute: 510,
      source: 'learned',
    });
    expect(reminderMinuteFor(null, 1430)).toEqual({
      minute: 20,
      source: 'learned',
    });
    expect(reminderMinuteFor(null, null)).toEqual({
      minute: DEFAULT_REMINDER_MINUTE,
      source: 'default',
    });
  });
});

describe('isDue', () => {
  it('is due for an hour after the reminder time, wrapping midnight', () => {
    expect(isDue(1200, 1200)).toBe(true);
    expect(isDue(1259, 1200)).toBe(true);
    expect(isDue(1260, 1200)).toBe(false);
    expect(isDue(1199, 1200)).toBe(false);
    expect(isDue(10, 1420)).toBe(true);
  });
});
