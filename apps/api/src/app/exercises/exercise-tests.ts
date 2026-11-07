import type { TestCase } from '@codify/domain';

export const MAX_TESTS_PER_EXERCISE = 100;
const MAX_TESTS_JSON_BYTES = 256 * 1024;

/** Read a stored tests JSON column into TestCase[] (lenient, for old rows). */
export function toTests(json: unknown): TestCase[] {
  if (!Array.isArray(json)) return [];
  return json.map((t, i) => {
    const o = (t ?? {}) as Record<string, unknown>;
    return {
      id:
        typeof o['id'] === 'string' && o['id'] ? (o['id'] as string) : `t${i}`,
      name:
        typeof o['name'] === 'string' && o['name']
          ? (o['name'] as string)
          : `Test ${i + 1}`,
      args: Array.isArray(o['args']) ? (o['args'] as unknown[]) : [],
      expected: o['expected'],
    };
  });
}

/**
 * Author-time checks for visible + hidden tests (admin save). Ids must be
 * unique across BOTH lists — results are matched to tests by id.
 */
export function validateTestCases(visible: unknown, hidden: unknown): string[] {
  const errors: string[] = [];
  const all: { list: string; t: unknown }[] = [];
  for (const [list, value] of [
    ['visibleTests', visible],
    ['hiddenTests', hidden],
  ] as const) {
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      errors.push(`${list} must be an array`);
      continue;
    }
    for (const t of value) all.push({ list, t });
  }
  if (all.length > MAX_TESTS_PER_EXERCISE)
    errors.push(`at most ${MAX_TESTS_PER_EXERCISE} tests per exercise`);
  if (
    JSON.stringify([visible ?? [], hidden ?? []]).length > MAX_TESTS_JSON_BYTES
  )
    errors.push('tests are too large');
  const seen = new Set<string>();
  all.forEach(({ list, t }, i) => {
    const o = (t ?? {}) as Record<string, unknown>;
    const where = `${list}[${i}]`;
    const id = o['id'];
    if (typeof id !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(id))
      errors.push(`${where}: id must be 1–80 characters of [A-Za-z0-9_.-]`);
    else if (seen.has(id)) errors.push(`${where}: duplicate test id "${id}"`);
    else seen.add(id);
    if (o['name'] !== undefined && typeof o['name'] !== 'string')
      errors.push(`${where}: name must be a string`);
    if (!Array.isArray(o['args']))
      errors.push(`${where}: args must be an array`);
    if (!('expected' in o)) errors.push(`${where}: expected is required`);
  });
  return errors;
}
