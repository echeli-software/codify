/**
 * Pure rubric-grading helpers for AI-prompt lessons (docs/17-ai-grading).
 *
 * A rubric is a list of weighted criteria. Deterministic criteria
 * (keyword / regex / word-count) are graded right here — testable, instant,
 * reproducible. `llm` criteria are graded by the API's AiGradingProvider (real
 * model in prod, a deterministic heuristic in dev) and merged back in; the
 * weighted scoring + pass decision still lives here so enforcement and
 * presentation never drift.
 *
 * Authoring rules live in `validateRubric` (run on admin save) and grading is
 * fail-closed for anything that slipped past it (unknown kinds, empty keyword
 * lists, unsafe regexes all FAIL instead of passing).
 */

export const CRITERION_KINDS = [
  'keyword',
  'regex',
  'minWords',
  'maxWords',
  'llm',
] as const;
export type CriterionKind = (typeof CRITERION_KINDS)[number];

/** Regex criteria: longest pattern an author may save. */
export const MAX_REGEX_PATTERN_LENGTH = 200;
/** Regex criteria: only this many characters of the response are matched. */
export const MAX_REGEX_INPUT_LENGTH = 10_000;
/** Regex flags an author may use (`g`/`y` make `.test` stateful). */
export const ALLOWED_REGEX_FLAGS = 'imsu';

export interface RubricCriterion {
  id: string;
  label: string;
  /** Relative weight (>0). Score is the weighted fraction of passed criteria. */
  weight: number;
  kind: CriterionKind;
  /** Kind-specific config (see each grader below). */
  config?: {
    /** keyword: passes if the response contains ANY of these (case-insensitive). */
    any?: string[];
    /** keyword: passes only if it contains ALL of these. */
    all?: string[];
    /** regex: pattern + optional flags. Matching is always case-insensitive. */
    pattern?: string;
    flags?: string;
    /** minWords / maxWords. */
    min?: number;
    max?: number;
    /** llm: concepts the judge should look for (used by the dev heuristic). */
    concepts?: string[];
    /** llm: instruction for the real model. */
    instruction?: string;
  };
}

export interface CriterionResult {
  id: string;
  label: string;
  weight: number;
  passed: boolean;
  /** Short human explanation ("found: error handling"). */
  detail?: string;
}

export interface RubricGrade {
  results: CriterionResult[];
  scorePct: number;
  passed: boolean;
}

export function isCriterionKind(kind: unknown): kind is CriterionKind {
  return (
    typeof kind === 'string' &&
    (CRITERION_KINDS as readonly string[]).includes(kind)
  );
}

/** Which criteria need the LLM provider (the rest are graded deterministically). */
export function isLlmCriterion(c: RubricCriterion): boolean {
  return c.kind === 'llm';
}

/**
 * The one text normalisation used by keyword AND regex criteria: Unicode
 * compatibility decomposition (so "é" and "é" compare equal) and
 * lower-casing. Regex patterns are NFKD-normalised too and always run with
 * the `i` flag, so both criterion kinds agree on what "contains" means.
 */
export function normalizeForMatch(s: string): string {
  return s.normalize('NFKD').toLowerCase();
}

function wordCount(s: string): number {
  const m = s.trim().match(/\S+/g);
  return m ? m.length : 0;
}

function nonEmptyTerms(list: unknown): string[] {
  return Array.isArray(list)
    ? list.filter(
        (k): k is string => typeof k === 'string' && k.trim().length > 0,
      )
    : [];
}

// ─── Regex safety ────────────────────────────────────────────────────────

/**
 * Static ReDoS screen. Rejects patterns with a quantified group that itself
 * contains a quantifier (`(a+)+`, `(\w*)*`, `(?:x{2,})+` …) — the classic
 * catastrophic-backtracking shape — and backreferences. Conservative by
 * design: an author can always rewrite the pattern without nesting.
 */
export function regexSafetyProblem(pattern: string): string | null {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH)
    return `pattern is longer than ${MAX_REGEX_PATTERN_LENGTH} characters`;
  // Stack of "does this open group contain a quantifier?"
  const stack: boolean[] = [];
  let lastGroupHadQuantifier = false;
  let prevWasGroupClose = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      const next = pattern[i + 1] ?? '';
      if (/[1-9]/.test(next) || next === 'k')
        return 'backreferences are not allowed';
      i += 1;
      prevWasGroupClose = false;
      continue;
    }
    if (ch === '[') {
      // Skip a character class (escapes inside it included).
      i += 1;
      if (pattern[i] === '^') i += 1;
      if (pattern[i] === ']') i += 1;
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') i += 1;
        i += 1;
      }
      prevWasGroupClose = false;
      continue;
    }
    if (ch === '(') {
      stack.push(false);
      prevWasGroupClose = false;
      continue;
    }
    if (ch === ')') {
      lastGroupHadQuantifier = stack.pop() ?? false;
      // A group that contains a quantifier taints its parent too.
      if (lastGroupHadQuantifier && stack.length)
        stack[stack.length - 1] = true;
      prevWasGroupClose = true;
      continue;
    }
    const isQuantifier =
      ch === '*' ||
      ch === '+' ||
      (ch === '{' && /^\{\d*,?\d*\}/.test(pattern.slice(i)));
    if (isQuantifier) {
      // `{n}` / `{0,1}` style bounded repeats of 1 are harmless; anything
      // that can repeat more than once counts.
      let unbounded = true;
      if (ch === '{') {
        const m = /^\{(\d*)(,?)(\d*)\}/.exec(pattern.slice(i));
        const max =
          m && m[2] === ''
            ? Number(m[1])
            : m && m[3] !== ''
              ? Number(m[3])
              : Infinity;
        unbounded = max > 1;
      }
      if (unbounded) {
        if (prevWasGroupClose && lastGroupHadQuantifier)
          return 'nested quantifiers (e.g. "(a+)+") can hang the grader';
        if (stack.length) stack[stack.length - 1] = true;
      }
      prevWasGroupClose = false;
      continue;
    }
    prevWasGroupClose = false;
  }
  return null;
}

/** Build the runtime RegExp for a criterion, or explain why it is unusable. */
export function compileCriterionRegex(
  pattern: string,
  flags = '',
): { re: RegExp | null; problem: string | null } {
  if (!pattern) return { re: null, problem: 'pattern is empty' };
  const safety = regexSafetyProblem(pattern);
  if (safety) return { re: null, problem: safety };
  for (const f of flags) {
    if (!ALLOWED_REGEX_FLAGS.includes(f))
      return {
        re: null,
        problem: `flag "${f}" is not allowed (use ${ALLOWED_REGEX_FLAGS})`,
      };
  }
  const finalFlags = Array.from(new Set(`${flags}i`)).join('');
  try {
    return {
      re: new RegExp(pattern.normalize('NFKD'), finalFlags),
      problem: null,
    };
  } catch (err) {
    return { re: null, problem: `invalid pattern: ${(err as Error).message}` };
  }
}

// ─── Grading ─────────────────────────────────────────────────────────────

/**
 * Grade a single deterministic criterion. Returns null for `llm` criteria
 * (those are the provider's job). Unknown kinds and misconfigured criteria
 * fail closed.
 */
export function gradeDeterministicCriterion(
  response: string,
  c: RubricCriterion,
): CriterionResult | null {
  if (c.kind === 'llm') return null;
  const base = { id: c.id, label: c.label, weight: c.weight };
  const text = normalizeForMatch(response);

  switch (c.kind) {
    case 'keyword': {
      const all = nonEmptyTerms(c.config?.all);
      const any = nonEmptyTerms(c.config?.any);
      if (all.length === 0 && any.length === 0) {
        return {
          ...base,
          passed: false,
          detail: 'criterion has no keywords configured',
        };
      }
      const missingAll = all.filter(
        (k) => !text.includes(normalizeForMatch(k)),
      );
      const hasAny =
        any.length === 0 ||
        any.some((k) => text.includes(normalizeForMatch(k)));
      const passed = missingAll.length === 0 && hasAny;
      const detail = passed
        ? 'mentions the expected terms'
        : missingAll.length
          ? `missing: ${missingAll.join(', ')}`
          : `expected one of: ${any.join(', ')}`;
      return { ...base, passed, detail };
    }
    case 'regex': {
      const { re, problem } = compileCriterionRegex(
        c.config?.pattern ?? '',
        c.config?.flags ?? '',
      );
      if (!re)
        return {
          ...base,
          passed: false,
          detail: `pattern unusable: ${problem}`,
        };
      const passed = re.test(
        response.normalize('NFKD').slice(0, MAX_REGEX_INPUT_LENGTH),
      );
      return {
        ...base,
        passed,
        detail: passed ? 'pattern matched' : 'pattern not found',
      };
    }
    case 'minWords': {
      const min = c.config?.min ?? 0;
      const n = wordCount(response);
      return {
        ...base,
        passed: n >= min,
        detail: `${n} words (need ≥ ${min})`,
      };
    }
    case 'maxWords': {
      const max = c.config?.max ?? Number.MAX_SAFE_INTEGER;
      const n = wordCount(response);
      return {
        ...base,
        passed: n <= max,
        detail: `${n} words (need ≤ ${max})`,
      };
    }
    default:
      return {
        ...base,
        passed: false,
        detail: `unsupported criterion kind "${String((c as { kind: unknown }).kind)}"`,
      };
  }
}

/** Weighted score (0–100) + pass decision from already-evaluated criteria. */
export function scoreRubric(
  results: CriterionResult[],
  passThreshold: number,
): RubricGrade {
  const totalWeight = results.reduce((s, r) => s + Math.max(0, r.weight), 0);
  const earned = results.reduce(
    (s, r) => s + (r.passed ? Math.max(0, r.weight) : 0),
    0,
  );
  const scorePct =
    totalWeight === 0 ? 0 : Math.round((earned / totalWeight) * 100);
  return { results, scorePct, passed: scorePct >= passThreshold };
}

// ─── Authoring validation ────────────────────────────────────────────────

/**
 * Author-time rubric checks (admin save). Returns human-readable problems;
 * empty = ok. Mirrors the fail-closed grading rules so a rubric that saves
 * can actually be passed.
 */
export function validateRubric(
  rubric: unknown,
  passThreshold: number,
): string[] {
  const errors: string[] = [];
  if (!Array.isArray(rubric)) return ['rubric must be an array of criteria'];
  const seen = new Set<string>();
  let totalWeight = 0;
  rubric.forEach((raw, i) => {
    const c = (raw ?? {}) as Partial<RubricCriterion>;
    const where = `criterion ${typeof c.id === 'string' && c.id ? `"${c.id}"` : `#${i + 1}`}`;
    if (typeof c.id !== 'string' || !c.id)
      errors.push(`${where}: id is required`);
    else if (seen.has(c.id)) errors.push(`${where}: duplicate id`);
    else seen.add(c.id);
    if (
      typeof c.weight !== 'number' ||
      !Number.isFinite(c.weight) ||
      c.weight < 0
    ) {
      errors.push(`${where}: weight must be a non-negative number`);
    } else {
      totalWeight += c.weight;
    }
    if (!isCriterionKind(c.kind)) {
      errors.push(
        `${where}: unknown kind "${String(c.kind)}" (expected one of ${CRITERION_KINDS.join(', ')})`,
      );
      return;
    }
    const cfg = c.config ?? {};
    switch (c.kind) {
      case 'keyword':
        if (
          nonEmptyTerms(cfg.any).length === 0 &&
          nonEmptyTerms(cfg.all).length === 0
        ) {
          errors.push(
            `${where}: keyword criterion needs at least one term in "any" or "all"`,
          );
        }
        break;
      case 'regex': {
        if (typeof cfg.pattern !== 'string' || !cfg.pattern) {
          errors.push(`${where}: regex criterion needs a pattern`);
          break;
        }
        const { problem } = compileCriterionRegex(
          cfg.pattern,
          typeof cfg.flags === 'string' ? cfg.flags : '',
        );
        if (problem) errors.push(`${where}: ${problem}`);
        break;
      }
      case 'minWords':
        if (
          typeof cfg.min !== 'number' ||
          !Number.isInteger(cfg.min) ||
          cfg.min < 1
        )
          errors.push(`${where}: minWords needs an integer "min" ≥ 1`);
        break;
      case 'maxWords':
        if (
          typeof cfg.max !== 'number' ||
          !Number.isInteger(cfg.max) ||
          cfg.max < 1
        )
          errors.push(`${where}: maxWords needs an integer "max" ≥ 1`);
        break;
      case 'llm':
        if (cfg.concepts !== undefined && !Array.isArray(cfg.concepts))
          errors.push(`${where}: concepts must be a list of strings`);
        break;
    }
  });
  if (totalWeight === 0 && passThreshold <= 0) {
    errors.push(
      'a rubric with no weighted criteria and a pass threshold of 0 would pass every answer',
    );
  } else if (totalWeight === 0 && rubric.length > 0) {
    errors.push('at least one criterion needs a weight above 0');
  }
  return errors;
}
