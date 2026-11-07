import {
  BUCKETS,
  bucket,
  evaluateFlag,
  parseFlagValue,
  pickVariant,
  type FlagRow,
} from './flag-evaluation.js';

const row = (
  value: FlagRow['value'],
  over: Partial<FlagRow> = {},
): FlagRow => ({
  key: 'exp.test',
  value,
  isActive: true,
  ...over,
});

const users = Array.from({ length: 4000 }, (_, i) => `user-${i}`);

describe('bucket', () => {
  it('is stable and in range', () => {
    expect(bucket('leagues.enabled:u1')).toBe(bucket('leagues.enabled:u1'));
    // Pinned value: the documented sha256 → uint32 BE → mod 10000 contract.
    expect(bucket('a')).toBe(0xca978112 % BUCKETS);
    for (const u of users.slice(0, 200)) {
      const b = bucket(`k:${u}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(BUCKETS);
    }
  });
});

describe('evaluateFlag', () => {
  it('missing, inactive or disabled → off', () => {
    expect(evaluateFlag(null, 'u')).toEqual({ enabled: false, variant: null });
    expect(evaluateFlag(row({ enabled: false }), 'u').enabled).toBe(false);
    expect(
      evaluateFlag(row({ enabled: true }, { isActive: false }), 'u').enabled,
    ).toBe(false);
  });

  it('enabled at 100% for everyone, deterministic per user', () => {
    const r = row({ enabled: true });
    expect(users.every((u) => evaluateFlag(r, u).enabled)).toBe(true);
    expect(evaluateFlag(r, null)).toEqual({ enabled: true, variant: null });
  });

  it('rollout percentage is roughly honoured and monotonic', () => {
    const at = (pct: number) =>
      new Set(
        users.filter(
          (u) =>
            evaluateFlag(row({ enabled: true, rolloutPct: pct }), u).enabled,
        ),
      );
    const ten = at(10);
    const fifty = at(50);
    expect(ten.size / users.length).toBeGreaterThan(0.07);
    expect(ten.size / users.length).toBeLessThan(0.13);
    expect(fifty.size / users.length).toBeGreaterThan(0.45);
    expect(fifty.size / users.length).toBeLessThan(0.55);
    for (const u of ten) expect(fifty.has(u)).toBe(true);
    expect(at(0).size).toBe(0);
  });

  it('holdout users get enabled false + variant "holdout", stable across rollout changes', () => {
    const holdout = (rollout: number) =>
      users.filter(
        (u) =>
          evaluateFlag(
            row({ enabled: true, holdoutPct: 10, rolloutPct: rollout }),
            u,
          ).variant === 'holdout',
      );
    const h1 = holdout(100);
    const h2 = holdout(30);
    expect(h1).toEqual(h2);
    expect(h1.length / users.length).toBeGreaterThan(0.07);
    expect(h1.length / users.length).toBeLessThan(0.13);
    for (const u of h1)
      expect(
        evaluateFlag(row({ enabled: true, holdoutPct: 10 }), u).enabled,
      ).toBe(false);
  });

  it('anonymous callers: never holdout, only at full rollout', () => {
    expect(
      evaluateFlag(row({ enabled: true, rolloutPct: 99 }), null).enabled,
    ).toBe(false);
    expect(
      evaluateFlag(
        row({ enabled: true, holdoutPct: 50, variants: { a: 0, b: 1 } }),
        null,
      ),
    ).toEqual({ enabled: true, variant: 'b' });
  });

  it('weighted variants split by weight and are stable', () => {
    const r = row({ enabled: true, variants: { control: 1, treatment: 3 } });
    const counts: Record<string, number> = {};
    for (const u of users) {
      const v = evaluateFlag(r, u).variant as string;
      counts[v] = (counts[v] ?? 0) + 1;
      expect(evaluateFlag(r, u).variant).toBe(v);
    }
    expect(counts['control'] / users.length).toBeGreaterThan(0.2);
    expect(counts['control'] / users.length).toBeLessThan(0.3);
    expect(counts['treatment'] / users.length).toBeGreaterThan(0.7);
  });
});

describe('pickVariant', () => {
  it('maps buckets onto cumulative weights and skips zero weights', () => {
    expect(pickVariant({ a: 1, b: 1 }, 0)).toBe('a');
    expect(pickVariant({ a: 1, b: 1 }, 4999)).toBe('a');
    expect(pickVariant({ a: 1, b: 1 }, 5000)).toBe('b');
    expect(pickVariant({ a: 0, b: 1 }, 0)).toBe('b');
    expect(pickVariant({}, 10)).toBeNull();
    expect(pickVariant(undefined, 10)).toBeNull();
  });
});

describe('parseFlagValue', () => {
  it('accepts a full value', () => {
    expect(
      parseFlagValue({
        enabled: true,
        rolloutPct: 25,
        holdoutPct: 5,
        variants: { a: 1, b: 2 },
        surface: 'public',
      }),
    ).toEqual({
      ok: true,
      value: {
        enabled: true,
        rolloutPct: 25,
        holdoutPct: 5,
        variants: { a: 1, b: 2 },
        surface: 'public',
      },
    });
  });

  it('lists every problem', () => {
    const res = parseFlagValue({
      enabled: 'yes',
      rolloutPct: 101,
      variants: { holdout: 1, 'bad key': 1, c: -1 },
      surface: 'Not Valid',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors).toHaveLength(6);
    expect(parseFlagValue([]).ok).toBe(false);
  });
});
