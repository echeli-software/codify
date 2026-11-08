/**
 * Badge rule helper builder model (docs/04 Badges, docs/07 §7): the common
 * rule shapes — `all` / `any` of event-count and metric clauses with one
 * numeric predicate each — as editable rows, converted to and from the
 * rule JSON. Anything else (several predicates, `where` filters, unknown
 * keys) stays in the raw JSON view.
 */

export const RULE_OPS = ['gte', 'gt', 'eq', 'lte', 'lt'] as const;
export type RuleOp = (typeof RULE_OPS)[number];

/** Fallbacks until the API's lists arrive (`POST /admin/badges/validate-rule`). */
export const DEFAULT_BADGE_EVENTS = [
  'lesson_complete',
  'exercise_pass',
  'ai_prompt_pass',
  'scenario_complete',
  'quiz_pass',
  'capstone_pass',
];
export const DEFAULT_BADGE_METRICS = [
  'streak.current_days',
  'streak.longest_days',
  'categories.completed',
  'lessons.completed',
  'certificates.capstone',
];

export interface RuleClauseRow {
  type: 'event' | 'metric';
  /** Event or metric name. */
  name: string;
  op: RuleOp;
  value: number;
}

export interface RuleBuilderState {
  combinator: 'all' | 'any';
  clauses: RuleClauseRow[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function singlePredicate(
  p: Record<string, unknown>,
  allowed: string[],
): { op: RuleOp; value: number } | null {
  const keys = Object.keys(p);
  if (keys.some((k) => !allowed.includes(k))) return null;
  const ops = keys.filter((k) => (RULE_OPS as readonly string[]).includes(k));
  if (ops.length !== 1) return null;
  const value = p[ops[0]];
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return { op: ops[0] as RuleOp, value };
}

/** Rule JSON → builder rows, or null when the shape needs the JSON view. */
export function parseRule(rule: unknown): RuleBuilderState | null {
  if (!isObj(rule)) return null;
  const keys = Object.keys(rule);
  if (keys.length !== 1 || (keys[0] !== 'all' && keys[0] !== 'any'))
    return null;
  const combinator = keys[0];
  const list = rule[combinator];
  if (!Array.isArray(list)) return null;
  const clauses: RuleClauseRow[] = [];
  for (const c of list) {
    if (!isObj(c)) return null;
    if (typeof c['event'] === 'string') {
      if (Object.keys(c).some((k) => k !== 'event' && k !== 'count'))
        return null;
      const count = c['count'] === undefined ? { gte: 1 } : c['count'];
      if (!isObj(count)) return null;
      const p = singlePredicate(count, [...RULE_OPS]);
      if (!p) return null;
      clauses.push({ type: 'event', name: c['event'], ...p });
    } else if (typeof c['metric'] === 'string') {
      const p = singlePredicate(c, ['metric', ...RULE_OPS]);
      if (!p) return null;
      clauses.push({ type: 'metric', name: c['metric'], ...p });
    } else return null;
  }
  return { combinator, clauses };
}

/** Builder rows → rule JSON (the DSL the API validates). */
export function buildRule(state: RuleBuilderState): Record<string, unknown> {
  return {
    [state.combinator]: state.clauses.map((c) =>
      c.type === 'event'
        ? { event: c.name, count: { [c.op]: Number(c.value) } }
        : { metric: c.name, [c.op]: Number(c.value) },
    ),
  };
}

/** Parse the raw JSON text; null when it isn't valid JSON. */
export function parseRuleText(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
