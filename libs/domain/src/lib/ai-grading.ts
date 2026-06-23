/**
 * Pure rubric-grading helpers for AI-prompt lessons (docs/17-ai-grading).
 *
 * A rubric is a list of weighted criteria. Deterministic criteria
 * (keyword / regex / word-count) are graded right here — testable, instant,
 * reproducible. `llm` criteria are graded by the API's AiGradingProvider (real
 * model in prod, a deterministic heuristic in dev) and merged back in; the
 * weighted scoring + pass decision still lives here so enforcement and
 * presentation never drift.
 */

export type CriterionKind = 'keyword' | 'regex' | 'minWords' | 'maxWords' | 'llm';

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
    /** regex: pattern + optional flags. */
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

/** Which criteria need the LLM provider (the rest are graded deterministically). */
export function isLlmCriterion(c: RubricCriterion): boolean {
  return c.kind === 'llm';
}

function norm(s: string): string {
  return s.normalize('NFKD').toLowerCase();
}

function wordCount(s: string): number {
  const m = s.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/**
 * Grade a single deterministic criterion. Returns null for `llm` criteria
 * (those are the provider's job).
 */
export function gradeDeterministicCriterion(response: string, c: RubricCriterion): CriterionResult | null {
  if (c.kind === 'llm') return null;
  const base = { id: c.id, label: c.label, weight: c.weight };
  const text = norm(response);

  switch (c.kind) {
    case 'keyword': {
      const all = c.config?.all ?? [];
      const any = c.config?.any ?? [];
      const missingAll = all.filter((k) => !text.includes(norm(k)));
      const hasAny = any.length === 0 || any.some((k) => text.includes(norm(k)));
      const passed = missingAll.length === 0 && hasAny;
      const detail = passed
        ? 'mentions the expected terms'
        : missingAll.length
          ? `missing: ${missingAll.join(', ')}`
          : `expected one of: ${any.join(', ')}`;
      return { ...base, passed, detail };
    }
    case 'regex': {
      let passed = false;
      try {
        passed = new RegExp(c.config?.pattern ?? '', c.config?.flags ?? 'i').test(response);
      } catch {
        passed = false;
      }
      return { ...base, passed, detail: passed ? 'pattern matched' : 'pattern not found' };
    }
    case 'minWords': {
      const min = c.config?.min ?? 0;
      const n = wordCount(response);
      return { ...base, passed: n >= min, detail: `${n} words (need ≥ ${min})` };
    }
    case 'maxWords': {
      const max = c.config?.max ?? Number.MAX_SAFE_INTEGER;
      const n = wordCount(response);
      return { ...base, passed: n <= max, detail: `${n} words (need ≤ ${max})` };
    }
    default:
      return null;
  }
}

/** Weighted score (0–100) + pass decision from already-evaluated criteria. */
export function scoreRubric(results: CriterionResult[], passThreshold: number): RubricGrade {
  const totalWeight = results.reduce((s, r) => s + Math.max(0, r.weight), 0);
  const earned = results.reduce((s, r) => s + (r.passed ? Math.max(0, r.weight) : 0), 0);
  const scorePct = totalWeight === 0 ? 0 : Math.round((earned / totalWeight) * 100);
  return { results, scorePct, passed: scorePct >= passThreshold };
}
