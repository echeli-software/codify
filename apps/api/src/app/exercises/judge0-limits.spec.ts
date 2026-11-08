import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateExerciseDto } from './exercises.dto.js';
import {
  DEFAULT_JUDGE0_CAPS,
  EXERCISE_MEMORY_LIMIT_KB,
  EXERCISE_TIME_LIMIT_MS,
  JUDGE0_WALL_TIME_LIMIT_S,
  effectiveLimits,
  judge0CapsFromEnv,
} from './judge0-limits.js';

const conf = readFileSync(
  join(__dirname, '../../../../../infra/judge0/judge0.conf.template'),
  'utf8',
);
const confValue = (key: string) =>
  Number(new RegExp(`^${key}=(\\S+)`, 'm').exec(conf)?.[1]);

describe('Judge0 limits', () => {
  it('match the MAX_* values of infra/judge0/judge0.conf.template', () => {
    expect(EXERCISE_TIME_LIMIT_MS.max).toBe(
      confValue('MAX_CPU_TIME_LIMIT') * 1000,
    );
    expect(EXERCISE_MEMORY_LIMIT_KB.max).toBe(confValue('MAX_MEMORY_LIMIT'));
    expect(JUDGE0_WALL_TIME_LIMIT_S).toBe(confValue('MAX_WALL_TIME_LIMIT'));
    expect(JUDGE0_WALL_TIME_LIMIT_S).toBe(confValue('WALL_TIME_LIMIT'));
  });

  it('DTO rejects limits Judge0 would refuse', () => {
    const errors = (body: object) =>
      validateSync(plainToInstance(UpdateExerciseDto, body)).map(
        (e) => e.property,
      );
    expect(errors({ timeLimitMs: 5000, memoryLimitKb: 256000 })).toEqual([]);
    expect(errors({ timeLimitMs: 10000 })).toEqual(['timeLimitMs']);
    expect(errors({ memoryLimitKb: 512000 })).toEqual(['memoryLimitKb']);
  });

  it('reads host caps from env, never above the DTO bounds', () => {
    expect(judge0CapsFromEnv({})).toEqual(DEFAULT_JUDGE0_CAPS);
    expect(
      judge0CapsFromEnv({
        JUDGE0_MAX_CPU_TIME_LIMIT: '3',
        JUDGE0_MAX_MEMORY_LIMIT: '128000',
        JUDGE0_MAX_WALL_TIME_LIMIT: '4',
      }),
    ).toEqual({ maxCpuMs: 3000, maxMemoryKb: 128000, maxWallS: 4 });
    expect(
      judge0CapsFromEnv({ JUDGE0_MAX_CPU_TIME_LIMIT: '20' }).maxCpuMs,
    ).toBe(5000);
    expect(() =>
      judge0CapsFromEnv({ JUDGE0_MAX_MEMORY_LIMIT: 'lots' }),
    ).toThrow(/JUDGE0_MAX_MEMORY_LIMIT/);
  });

  it('clamps an exercise to the caps (legacy rows above the cap still run)', () => {
    expect(
      effectiveLimits({ timeLimitMs: 10_000, memoryLimitKb: 512_000 }),
    ).toEqual({
      cpuMs: 5000,
      memoryKb: 256000,
      wallS: 5,
    });
    expect(
      effectiveLimits({ timeLimitMs: 2000, memoryLimitKb: 128_000 }),
    ).toEqual({
      cpuMs: 2000,
      memoryKb: 128000,
      wallS: 5,
    });
  });
});
