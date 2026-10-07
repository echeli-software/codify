/**
 * Pure exercise-grading helpers (docs/12-code-execution.md). The actual
 * sandboxed execution happens in the API (Judge0 in prod, a vm-based dev
 * executor locally); this module owns the deterministic, testable parts:
 * comparing actual vs expected, scoring, and verdict mapping.
 */

export interface TestCase {
  id: string;
  name: string;
  args: unknown[];
  expected: unknown;
  hidden?: boolean;
}

export interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  actual?: unknown;
  expected?: unknown;
  runtimeMs?: number;
  error?: string;
}

export type ExecutionErrorKind =
  | 'timeout'
  | 'runtime'
  | 'memory'
  | 'error'
  | null;
export type Verdict =
  | 'PASS'
  | 'FAIL'
  | 'ERROR'
  | 'TIMEOUT'
  | 'MEMORY'
  | 'RUNTIME';

/** Structural equality for JSON-ish values (handles arrays, objects, NaN). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number')
    return Number.isNaN(a) && Number.isNaN(b);
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object'
  )
    return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
  );
}

/** Percentage of tests passed, 0–100 (0 when there are no tests). */
export function scoreFromResults(results: TestResult[]): number {
  if (results.length === 0) return 0;
  const passed = results.filter((r) => r.passed).length;
  return Math.round((passed / results.length) * 100);
}

export function allPassed(results: TestResult[]): boolean {
  return results.length > 0 && results.every((r) => r.passed);
}

/**
 * Final verdict: an execution-level error (timeout/runtime/…) overrides the
 * test outcome; otherwise PASS iff every test passed, else FAIL.
 */
export function verdictFromResults(
  results: TestResult[],
  errorKind: ExecutionErrorKind = null,
): Verdict {
  switch (errorKind) {
    case 'timeout':
      return 'TIMEOUT';
    case 'memory':
      return 'MEMORY';
    case 'runtime':
      return 'RUNTIME';
    case 'error':
      return 'ERROR';
    default:
      return allPassed(results) ? 'PASS' : 'FAIL';
  }
}

// ─── Languages ───────────────────────────────────────────────────────────

/** Languages an exercise may be authored in (docs/12 §4). */
export const EXERCISE_LANGUAGES = [
  'javascript',
  'typescript',
  'python',
] as const;
export type ExerciseLanguage = (typeof EXERCISE_LANGUAGES)[number];

export function isExerciseLanguage(value: string): value is ExerciseLanguage {
  return (EXERCISE_LANGUAGES as readonly string[]).includes(value);
}

/**
 * `entryFunction` is interpolated into generated harness source, so it must
 * be a plain identifier valid in every supported language.
 */
export const ENTRY_FUNCTION_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/;

// ─── Hidden-test redaction ───────────────────────────────────────────────

/** A result as stored server-side: `hidden` marks tests from hiddenTestsJson. */
export interface StoredTestResult extends TestResult {
  hidden?: boolean;
}

/** Generic copy shown for a failing hidden test (never its inputs/outputs). */
export const HIDDEN_TEST_FAILED_MESSAGE =
  'A hidden test failed. Check edge cases.';

/**
 * Student-facing view of a submit result (docs/12 §6 "Visible vs hidden
 * tests"). Visible tests keep their diff (actual / expected / error). Hidden
 * tests NEVER expose args, expected, actual or error text; until the whole
 * submission passes they are also anonymised ("Hidden test 2") so their
 * names cannot leak hints. On a full pass hidden names are revealed.
 */
export function redactHiddenResults(
  results: StoredTestResult[],
  fullPass: boolean,
): StoredTestResult[] {
  let n = 0;
  return results.map((r) => {
    if (!r.hidden) {
      const { hidden: _hidden, ...visible } = r;
      return visible;
    }
    n += 1;
    const out: StoredTestResult = {
      id: fullPass ? r.id : `hidden-${n}`,
      name: fullPass ? r.name : `Hidden test ${n}`,
      passed: r.passed,
      hidden: true,
    };
    if (!r.passed) out.error = HIDDEN_TEST_FAILED_MESSAGE;
    return out;
  });
}
