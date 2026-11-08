/**
 * Sandbox limits shared by the exercise DTOs and the Judge0 executor
 * (docs/12 §3). The DTO bounds match the MAX_* values in
 * infra/judge0/judge0.conf.template, so an exercise can never ask Judge0
 * for more than it accepts (Judge0 rejects such submissions outright).
 * Keep apps/admin exercise-editor validation in sync.
 */

/** Fixed wall-clock limit per submission (docs/12 §3). */
export const JUDGE0_WALL_TIME_LIMIT_S = 5;

/** Exercise.timeLimitMs bounds — Judge0 MAX_CPU_TIME_LIMIT=5 (s). */
export const EXERCISE_TIME_LIMIT_MS = { min: 100, max: 5000 } as const;

/** Exercise.memoryLimitKb bounds — Judge0 MAX_MEMORY_LIMIT=256000 (KB). */
export const EXERCISE_MEMORY_LIMIT_KB = { min: 16000, max: 256000 } as const;

/** Judge0 MAX_CPU_EXTRA_TIME=1; we always ask for 0.5 s. */
export const JUDGE0_CPU_EXTRA_TIME_S = 0.5;

export interface Judge0Caps {
  /** Highest cpu_time_limit the Judge0 host accepts, in ms. */
  maxCpuMs: number;
  /** Highest memory_limit the Judge0 host accepts, in KB. */
  maxMemoryKb: number;
  /** Highest wall_time_limit the Judge0 host accepts, in seconds. */
  maxWallS: number;
}

export const DEFAULT_JUDGE0_CAPS: Readonly<Judge0Caps> = {
  maxCpuMs: EXERCISE_TIME_LIMIT_MS.max,
  maxMemoryKb: EXERCISE_MEMORY_LIMIT_KB.max,
  maxWallS: JUDGE0_WALL_TIME_LIMIT_S,
};

function positive(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`${key}: expected a positive number, got "${raw}"`);
  return n;
}

/**
 * The Judge0 host's caps, from JUDGE0_MAX_CPU_TIME_LIMIT (s),
 * JUDGE0_MAX_MEMORY_LIMIT (KB) and JUDGE0_MAX_WALL_TIME_LIMIT (s) — set
 * them to the MAX_* values of a Judge0 host configured differently from
 * judge0.conf.template. Never above the DTO bounds.
 */
export function judge0CapsFromEnv(env: NodeJS.ProcessEnv): Judge0Caps {
  return {
    maxCpuMs: Math.min(
      EXERCISE_TIME_LIMIT_MS.max,
      Math.round(positive(env, 'JUDGE0_MAX_CPU_TIME_LIMIT', 5) * 1000),
    ),
    maxMemoryKb: Math.min(
      EXERCISE_MEMORY_LIMIT_KB.max,
      Math.round(positive(env, 'JUDGE0_MAX_MEMORY_LIMIT', 256000)),
    ),
    maxWallS: positive(env, 'JUDGE0_MAX_WALL_TIME_LIMIT', 5),
  };
}

export interface EffectiveLimits {
  cpuMs: number;
  memoryKb: number;
  wallS: number;
}

/** Clamp an exercise's limits to what the Judge0 host accepts. */
export function effectiveLimits(
  req: { timeLimitMs: number; memoryLimitKb: number },
  caps: Judge0Caps = DEFAULT_JUDGE0_CAPS,
): EffectiveLimits {
  return {
    cpuMs: Math.max(
      EXERCISE_TIME_LIMIT_MS.min,
      Math.min(req.timeLimitMs, caps.maxCpuMs),
    ),
    memoryKb: Math.max(
      EXERCISE_MEMORY_LIMIT_KB.min,
      Math.min(req.memoryLimitKb, caps.maxMemoryKb),
    ),
    wallS: Math.min(JUDGE0_WALL_TIME_LIMIT_S, caps.maxWallS),
  };
}
