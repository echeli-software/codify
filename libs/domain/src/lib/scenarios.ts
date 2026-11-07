/**
 * Pure helpers for branching-dialogue scenario lessons (Phase 12). A scenario
 * is a directed graph of dialogue nodes; each choice either advances to
 * another node (`to`) or ends the scenario (`ending`, with an `outcome`).
 *
 * The API validates author graphs and replays a student's choice path against
 * the same functions, so authoring guarantees and runtime enforcement never
 * drift.
 */

export interface ScenarioChoice {
  id: string;
  label: string;
  /** Target node id (required unless `ending`). */
  to?: string;
  /** Terminal choice — completes the scenario. */
  ending?: boolean;
  /** Outcome tag recorded on completion (e.g. "resolved", "escalated"). */
  outcome?: string;
}

export interface ScenarioNode {
  id: string;
  speaker?: string;
  text: string;
  choices: ScenarioChoice[];
}

export interface ScenarioGraph {
  startId: string;
  nodes: Record<string, ScenarioNode>;
}

export interface WalkResult {
  valid: boolean;
  /** Node ids visited, in order (always starts at startId). */
  path: string[];
  /** Number of choices made (branch depth reached). */
  depth: number;
  completed: boolean;
  outcome?: string;
  reason?: string;
}

/** Upper bounds that keep a hostile graph from exhausting the validator. */
export const MAX_SCENARIO_NODES = 500;
export const MAX_CHOICES_PER_NODE = 12;

/** Own-property node lookup — never resolves `__proto__`, `toString`, … */
function nodeOf(
  graph: ScenarioGraph,
  id: string | undefined,
): ScenarioNode | undefined {
  if (
    typeof id !== 'string' ||
    !graph?.nodes ||
    typeof graph.nodes !== 'object'
  )
    return undefined;
  return Object.hasOwn(graph.nodes, id) ? graph.nodes[id] : undefined;
}

function choicesOf(node: ScenarioNode | undefined): ScenarioChoice[] {
  return Array.isArray(node?.choices) ? node.choices : [];
}

/**
 * Node ids reachable from the start node (DFS over `to` edges, cycle-safe).
 * Shared by validation (ending reachability) and depth calculation.
 */
export function reachableNodeIds(graph: ScenarioGraph): Set<string> {
  const seen = new Set<string>();
  if (!nodeOf(graph, graph?.startId)) return seen;
  const stack = [graph.startId];
  while (stack.length) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const c of choicesOf(nodeOf(graph, id))) {
      if (!c.ending && c.to && nodeOf(graph, c.to) && !seen.has(c.to))
        stack.push(c.to);
    }
  }
  return seen;
}

/** True when the node ends the scenario: an `ending` choice, or no choices. */
function nodeCanEnd(node: ScenarioNode | undefined): boolean {
  const choices = choicesOf(node);
  return choices.length === 0 || choices.some((c) => c.ending);
}

/** Author-time validation. Returns a list of human-readable problems (empty = ok). */
export function validateScenario(graph: ScenarioGraph): string[] {
  const errors: string[] = [];
  if (!graph || typeof graph !== 'object') return ['scenario graph is missing'];
  if (
    !graph.nodes ||
    typeof graph.nodes !== 'object' ||
    Array.isArray(graph.nodes)
  )
    return ['scenario graph has no nodes'];
  const entries = Object.entries(graph.nodes);
  if (entries.length > MAX_SCENARIO_NODES)
    return [`scenario has more than ${MAX_SCENARIO_NODES} nodes`];

  const start = nodeOf(graph, graph.startId);
  if (!start) errors.push('start node is missing');
  else if (choicesOf(start).length === 0)
    errors.push('start node has no choices');

  let hasEnding = false;
  for (const [key, node] of entries) {
    if (!node || typeof node !== 'object') {
      errors.push(`node "${key}" is not an object`);
      continue;
    }
    if (node.id !== key)
      errors.push(`node "${key}" has mismatched id "${String(node.id)}"`);
    if (!node.text) errors.push(`node "${key}" has no text`);
    if (node.choices !== undefined && !Array.isArray(node.choices)) {
      errors.push(`node "${key}" choices must be a list`);
      continue;
    }
    const choices = choicesOf(node);
    if (choices.length > MAX_CHOICES_PER_NODE)
      errors.push(
        `node "${key}" has more than ${MAX_CHOICES_PER_NODE} choices`,
      );
    const choiceIds = new Set<string>();
    for (const c of choices) {
      if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id) {
        errors.push(`a choice in "${key}" has no id`);
        continue;
      }
      if (choiceIds.has(c.id))
        errors.push(`node "${key}" has duplicate choice id "${c.id}"`);
      choiceIds.add(c.id);
      if (!c.label) errors.push(`choice "${c.id}" in "${key}" has no label`);
      if (c.ending) {
        hasEnding = true;
        continue;
      }
      if (!c.to || !nodeOf(graph, c.to))
        errors.push(
          `choice "${c.label ?? c.id}" in "${key}" points to a missing node`,
        );
    }
    // A node with no choices is itself a terminal/ending node.
    if (choices.length === 0) hasEnding = true;
  }
  if (!hasEnding) errors.push('scenario has no ending');
  else if (start) {
    const reachable = reachableNodeIds(graph);
    if (![...reachable].some((id) => nodeCanEnd(nodeOf(graph, id)))) {
      errors.push('no ending is reachable from the start node');
    }
  }
  return errors;
}

/** Replay an ordered list of choice ids from the start node. */
export function walkScenario(
  graph: ScenarioGraph,
  choiceIds: string[],
): WalkResult {
  if (!nodeOf(graph, graph?.startId)) {
    return {
      valid: false,
      path: [],
      depth: 0,
      completed: false,
      reason: 'missing start node',
    };
  }
  let nodeId = graph.startId;
  const path = [nodeId];
  let depth = 0;

  for (const cid of choiceIds) {
    const node = nodeOf(graph, nodeId);
    const choice = choicesOf(node).find((c) => c.id === cid);
    if (!choice) {
      return {
        valid: false,
        path,
        depth,
        completed: false,
        reason: `invalid choice "${cid}" at "${nodeId}"`,
      };
    }
    depth += 1;
    if (choice.ending) {
      if (choice.to && nodeOf(graph, choice.to)) path.push(choice.to);
      return {
        valid: true,
        path,
        depth,
        completed: true,
        outcome: choice.outcome,
      };
    }
    if (!choice.to || !nodeOf(graph, choice.to)) {
      return {
        valid: false,
        path,
        depth,
        completed: false,
        reason: `choice "${cid}" has no valid target`,
      };
    }
    nodeId = choice.to;
    path.push(nodeId);
  }

  // Ran out of choices: complete iff we landed on a terminal (choiceless) node.
  const terminal = choicesOf(nodeOf(graph, nodeId)).length === 0;
  return { valid: true, path, depth, completed: terminal };
}

/** The longest reachable branch depth (number of choices), cycle-safe. */
export function scenarioMaxDepth(graph: ScenarioGraph): number {
  if (!nodeOf(graph, graph?.startId)) return 0;
  const dfs = (nodeId: string, visiting: Set<string>): number => {
    const choices = choicesOf(nodeOf(graph, nodeId));
    if (choices.length === 0) return 0;
    let best = 0;
    for (const c of choices) {
      if (c.ending) {
        best = Math.max(best, 1);
        continue;
      }
      if (!c.to || !nodeOf(graph, c.to) || visiting.has(c.to)) continue;
      visiting.add(c.to);
      best = Math.max(best, 1 + dfs(c.to, visiting));
      visiting.delete(c.to);
    }
    return best;
  };
  return dfs(graph.startId, new Set([graph.startId]));
}
