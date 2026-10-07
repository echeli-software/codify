import type { RubricCriterion } from '@codify/api-client';

export type CriterionKind = RubricCriterion['kind'];

export const CRITERION_KINDS: readonly CriterionKind[] = [
  'keyword',
  'regex',
  'minWords',
  'maxWords',
  'llm',
];

/** Flags the API accepts on regex criteria (`g`/`y` are stateful → rejected). */
export const ALLOWED_REGEX_FLAGS = 'imsu';

/**
 * Editable form of one rubric criterion. Term lists are kept as one string
 * (one term per line or comma-separated) so they bind to a textarea.
 */
export interface CriterionDraft {
  /** Stable client key for @for tracking / error mapping. */
  uid: string;
  id: string;
  label: string;
  weight: number;
  kind: CriterionKind;
  any: string;
  all: string;
  pattern: string;
  flags: string;
  min: number | null;
  max: number | null;
  concepts: string;
  instruction: string;
}

let uidSeq = 0;
const nextUid = () => `crit-${++uidSeq}`;

export function splitTerms(s: string): string[] {
  return s
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function toDraft(c: RubricCriterion): CriterionDraft {
  const cfg = (c.config ?? {}) as Record<string, unknown>;
  const list = (v: unknown) =>
    Array.isArray(v) ? v.map(String).join('\n') : '';
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  return {
    uid: nextUid(),
    id: c.id,
    label: c.label,
    weight: c.weight,
    kind: c.kind,
    any: list(cfg['any']),
    all: list(cfg['all']),
    pattern: typeof cfg['pattern'] === 'string' ? cfg['pattern'] : '',
    flags: typeof cfg['flags'] === 'string' ? cfg['flags'] : '',
    min: num(cfg['min']),
    max: num(cfg['max']),
    concepts: list(cfg['concepts']),
    instruction:
      typeof cfg['instruction'] === 'string' ? cfg['instruction'] : '',
  };
}

/** Only the config keys that belong to the criterion's kind are sent. */
export function fromDraft(d: CriterionDraft): RubricCriterion {
  const base = {
    id: d.id.trim(),
    label: d.label.trim(),
    weight: Number(d.weight),
    kind: d.kind,
  };
  switch (d.kind) {
    case 'keyword': {
      const config: Record<string, unknown> = {};
      const any = splitTerms(d.any);
      const all = splitTerms(d.all);
      if (any.length) config['any'] = any;
      if (all.length) config['all'] = all;
      return { ...base, config };
    }
    case 'regex':
      return {
        ...base,
        config: d.flags
          ? { pattern: d.pattern, flags: d.flags }
          : { pattern: d.pattern },
      };
    case 'minWords':
      return {
        ...base,
        config: { min: d.min === null ? null : Number(d.min) },
      };
    case 'maxWords':
      return {
        ...base,
        config: { max: d.max === null ? null : Number(d.max) },
      };
    case 'llm': {
      const config: Record<string, unknown> = {};
      const concepts = splitTerms(d.concepts);
      if (concepts.length) config['concepts'] = concepts;
      if (d.instruction.trim()) config['instruction'] = d.instruction.trim();
      return { ...base, config };
    }
  }
}

/** Unique criterion id like `c1`, `c2`… not already used in the list. */
export function nextCriterionId(list: readonly CriterionDraft[]): string {
  const used = new Set(list.map((c) => c.id));
  let n = list.length + 1;
  while (used.has(`c${n}`)) n++;
  return `c${n}`;
}

export function newCriterion(
  list: readonly CriterionDraft[],
  kind: CriterionKind = 'keyword',
): CriterionDraft {
  return {
    uid: nextUid(),
    id: nextCriterionId(list),
    label: '',
    weight: 1,
    kind,
    any: '',
    all: '',
    pattern: '',
    flags: '',
    min: kind === 'minWords' ? 20 : null,
    max: kind === 'maxWords' ? 200 : null,
    concepts: '',
    instruction: '',
  };
}

export function addCriterion(
  list: readonly CriterionDraft[],
  kind: CriterionKind = 'keyword',
): CriterionDraft[] {
  return [...list, newCriterion(list, kind)];
}

export function removeCriterion(
  list: readonly CriterionDraft[],
  uid: string,
): CriterionDraft[] {
  return list.filter((c) => c.uid !== uid);
}

/** Move a criterion up (-1) or down (+1); out-of-range moves are no-ops. */
export function moveCriterion(
  list: readonly CriterionDraft[],
  uid: string,
  delta: -1 | 1,
): CriterionDraft[] {
  const i = list.findIndex((c) => c.uid === uid);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export function totalWeight(list: readonly CriterionDraft[]): number {
  return list.reduce(
    (sum, c) =>
      sum + (Number.isFinite(Number(c.weight)) ? Number(c.weight) : 0),
    0,
  );
}

/**
 * Weights are relative (score = weighted share of passed criteria), so any
 * positive total works; 100 just reads naturally as percentages.
 */
export function weightHint(
  list: readonly CriterionDraft[],
): 'empty' | 'zero' | 'percent' | 'relative' {
  if (list.length === 0) return 'empty';
  const total = totalWeight(list);
  if (total <= 0) return 'zero';
  return Math.abs(total - 100) < 1e-9 ? 'percent' : 'relative';
}

/** Share of the score each criterion carries (0..1), for the weight column. */
export function weightShare(
  list: readonly CriterionDraft[],
  c: CriterionDraft,
): number {
  const total = totalWeight(list);
  return total > 0 ? Math.max(0, Number(c.weight) || 0) / total : 0;
}

/** Client-side checks mirroring the API's `validateRubric` (field-level). */
export function draftProblems(c: CriterionDraft): string[] {
  const out: string[] = [];
  if (!c.id.trim()) out.push('id');
  if (!c.label.trim()) out.push('label');
  if (!Number.isFinite(Number(c.weight)) || Number(c.weight) < 0)
    out.push('weight');
  switch (c.kind) {
    case 'keyword':
      if (!splitTerms(c.any).length && !splitTerms(c.all).length)
        out.push('terms');
      break;
    case 'regex':
      if (!c.pattern) out.push('pattern');
      else {
        try {
          new RegExp(c.pattern, c.flags);
        } catch {
          out.push('pattern');
        }
      }
      if ([...c.flags].some((f) => !ALLOWED_REGEX_FLAGS.includes(f)))
        out.push('flags');
      break;
    case 'minWords':
      if (!(Number.isInteger(Number(c.min)) && Number(c.min) >= 1))
        out.push('min');
      break;
    case 'maxWords':
      if (!(Number.isInteger(Number(c.max)) && Number(c.max) >= 1))
        out.push('max');
      break;
  }
  return out;
}

/**
 * Map `INVALID_RUBRIC` messages ("criterion \"c2\": regex criterion needs a
 * pattern", "criterion #3: …") to the criterion they belong to; anything
 * not tied to a criterion is returned under `general`.
 */
export function mapRubricErrors(
  messages: readonly string[],
  list: readonly CriterionDraft[],
): { byUid: Record<string, string[]>; general: string[] } {
  const byUid: Record<string, string[]> = {};
  const general: string[] = [];
  for (const msg of messages) {
    const m = /^criterion (?:"([^"]+)"|#(\d+)):\s*(.+)$/.exec(msg.trim());
    const target = m
      ? m[1] !== undefined
        ? list.find((c) => c.id.trim() === m[1])
        : list[Number(m[2]) - 1]
      : undefined;
    if (m && target) (byUid[target.uid] ??= []).push(m[3]);
    else general.push(msg);
  }
  return { byUid, general };
}
