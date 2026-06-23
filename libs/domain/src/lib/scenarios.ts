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

/** Author-time validation. Returns a list of human-readable problems (empty = ok). */
export function validateScenario(graph: ScenarioGraph): string[] {
  const errors: string[] = [];
  if (!graph || typeof graph !== 'object') return ['scenario graph is missing'];
  if (!graph.startId || !graph.nodes?.[graph.startId]) errors.push('start node is missing');
  let hasEnding = false;
  for (const node of Object.values(graph.nodes ?? {})) {
    if (!node.text) errors.push(`node "${node.id}" has no text`);
    for (const c of node.choices ?? []) {
      if (c.ending) {
        hasEnding = true;
        continue;
      }
      if (!c.to || !graph.nodes[c.to]) errors.push(`choice "${c.label}" in "${node.id}" points to a missing node`);
    }
    // A node with no choices is itself a terminal/ending node.
    if ((node.choices ?? []).length === 0) hasEnding = true;
  }
  if (!hasEnding) errors.push('scenario has no ending');
  return errors;
}

/** Replay an ordered list of choice ids from the start node. */
export function walkScenario(graph: ScenarioGraph, choiceIds: string[]): WalkResult {
  if (!graph?.startId || !graph.nodes?.[graph.startId]) {
    return { valid: false, path: [], depth: 0, completed: false, reason: 'missing start node' };
  }
  let nodeId = graph.startId;
  const path = [nodeId];
  let depth = 0;

  for (const cid of choiceIds) {
    const node = graph.nodes[nodeId];
    const choice = node.choices?.find((c) => c.id === cid);
    if (!choice) {
      return { valid: false, path, depth, completed: false, reason: `invalid choice "${cid}" at "${nodeId}"` };
    }
    depth += 1;
    if (choice.ending) {
      if (choice.to && graph.nodes[choice.to]) path.push(choice.to);
      return { valid: true, path, depth, completed: true, outcome: choice.outcome };
    }
    if (!choice.to || !graph.nodes[choice.to]) {
      return { valid: false, path, depth, completed: false, reason: `choice "${cid}" has no valid target` };
    }
    nodeId = choice.to;
    path.push(nodeId);
  }

  // Ran out of choices: complete iff we landed on a terminal (choiceless) node.
  const terminal = (graph.nodes[nodeId]?.choices?.length ?? 0) === 0;
  return { valid: true, path, depth, completed: terminal };
}

/** The longest reachable branch depth (number of choices), cycle-safe. */
export function scenarioMaxDepth(graph: ScenarioGraph): number {
  if (!graph?.startId || !graph.nodes?.[graph.startId]) return 0;
  const dfs = (nodeId: string, visiting: Set<string>): number => {
    const node = graph.nodes[nodeId];
    if (!node || node.choices.length === 0) return 0;
    let best = 0;
    for (const c of node.choices) {
      if (c.ending) {
        best = Math.max(best, 1);
        continue;
      }
      if (!c.to || !graph.nodes[c.to] || visiting.has(c.to)) continue;
      visiting.add(c.to);
      best = Math.max(best, 1 + dfs(c.to, visiting));
      visiting.delete(c.to);
    }
    return best;
  };
  return dfs(graph.startId, new Set([graph.startId]));
}
