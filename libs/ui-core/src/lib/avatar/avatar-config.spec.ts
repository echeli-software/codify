import {
  DEFAULT_AVATAR_CONFIG,
  EYE_COLORS,
  HAIR_COLORS,
  SKIN_TONES,
  SKIN_TONE_HEX,
  normalizeAvatarConfig,
  randomAvatarConfig,
  validateAvatarConfig,
} from './index.js';

describe('avatar config', () => {
  it('has all 8 skin tones from docs/08 §5, each with a colour', () => {
    expect(SKIN_TONES).toHaveLength(8);
    for (const t of SKIN_TONES) expect(SKIN_TONE_HEX[t]).toMatch(/^#/);
  });

  it('accepts a valid partial patch and normalizes colour case', () => {
    const res = validateAvatarConfig({
      skinTone: 'olive',
      baseHairColor: HAIR_COLORS[2].toUpperCase(),
      pose: 'cheer',
    });
    expect(res).toEqual({
      ok: true,
      value: {
        skinTone: 'olive',
        baseHairColor: HAIR_COLORS[2],
        pose: 'cheer',
      },
    });
  });

  it('rejects unknown keys, bad values and non-objects', () => {
    const res = validateAvatarConfig({
      skinTone: 'green',
      eyeColor: 12,
      hat: 'x',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors).toHaveLength(3);
      expect(res.errors[0]).toMatch(/^skinTone: must be one of porcelain/);
      expect(res.errors[2]).toBe('hat: unknown avatar setting');
    }
    expect(validateAvatarConfig(null)).toEqual({
      ok: false,
      errors: ['config: must be an object'],
    });
    expect(validateAvatarConfig([1]).ok).toBe(false);
  });

  it('normalizes stored configs, keeping valid fields only', () => {
    expect(normalizeAvatarConfig(null)).toEqual(DEFAULT_AVATAR_CONFIG);
    expect(normalizeAvatarConfig(['x'])).toEqual(DEFAULT_AVATAR_CONFIG);
    expect(
      normalizeAvatarConfig({ skinTone: 'deep', eyeColor: '#nothex' }),
    ).toEqual({ ...DEFAULT_AVATAR_CONFIG, skinTone: 'deep' });
  });

  it('builds a random config from the rng, honouring kept fields', () => {
    const lo = randomAvatarConfig(() => 0);
    expect(lo.skinTone).toBe('porcelain');
    expect(lo.eyeColor).toBe(EYE_COLORS[0]);
    const hi = randomAvatarConfig(() => 0.9999, { pose: 'idle' });
    expect(hi.skinTone).toBe('deep');
    expect(hi.pose).toBe('idle');
    // An rng that returns 1 still stays in range.
    expect(randomAvatarConfig(() => 1).baseBodyId).toBe('slim');
  });
});

describe('avatar entry points', () => {
  it('re-exports every palette from the module and the package root', async () => {
    const mod = await import('./index.js');
    const direct = await import('./avatar-config.js');
    const root = await import('../../index.js');
    for (const key of Object.keys(direct)) {
      expect((mod as Record<string, unknown>)[key]).toBe(
        (direct as Record<string, unknown>)[key],
      );
      expect((root as Record<string, unknown>)[key]).toBe(
        (direct as Record<string, unknown>)[key],
      );
    }
    expect(mod.AVATAR_CONFIG_KEYS).toContain('pose');
    expect(mod.AVATAR_POSES).toContain('cheer');
    expect(mod.BASE_BODIES).toHaveLength(3);
    expect(mod.HAIR_STYLES).toContain('covered');
  });
});
