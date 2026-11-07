import type { ScenarioChoice, ScenarioGraph } from '@codify/api-client';
import { validateScenario } from '@codify/domain';

/** Editable choice: `target` is a node id, or '' when it's an ending. */
export interface ChoiceDraft {
  uid: string;
  id: string;
  label: string;
  target: string;
  ending: boolean;
  outcome: string;
}

export interface NodeDraft {
  uid: string;
  id: string;
  speaker: string;
  text: string;
  choices: ChoiceDraft[];
}

/** The visual editor's model: an ordered node list + start node id. */
export interface ScenarioDraft {
  startId: string;
  nodes: NodeDraft[];
}

let seq = 0;
const uid = (p: string) => `${p}-${++seq}`;

/** Breadth-first order from `startId`, then any unreachable nodes. */
function orderedKeys(g: ScenarioGraph): string[] {
  const keys = Object.keys(g.nodes ?? {});
  const seen = new Set<string>();
  const queue = g.nodes?.[g.startId] ? [g.startId] : [];
  const out: string[] = [];
  for (let k = queue.shift(); k !== undefined; k = queue.shift()) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    for (const c of g.nodes[k]?.choices ?? []) {
      if (!c.ending && c.to && g.nodes[c.to] && !seen.has(c.to))
        queue.push(c.to);
    }
  }
  return [...out, ...keys.filter((k) => !seen.has(k))];
}

export function graphToDraft(g: ScenarioGraph): ScenarioDraft {
  return {
    startId: g.startId ?? '',
    nodes: orderedKeys(g).map((key) => {
      const n = g.nodes[key];
      return {
        uid: uid('node'),
        id: key,
        speaker: n?.speaker ?? '',
        text: n?.text ?? '',
        choices: (n?.choices ?? []).map((c) => ({
          uid: uid('choice'),
          id: c.id,
          label: c.label ?? '',
          target: c.ending ? '' : (c.to ?? ''),
          ending: !!c.ending,
          outcome: c.outcome ?? '',
        })),
      };
    }),
  };
}

export function draftToGraph(d: ScenarioDraft): ScenarioGraph {
  const nodes: ScenarioGraph['nodes'] = {};
  for (const n of d.nodes) {
    const id = n.id.trim();
    nodes[id] = {
      id,
      ...(n.speaker.trim() ? { speaker: n.speaker.trim() } : {}),
      text: n.text,
      choices: n.choices.map((c): ScenarioChoice => {
        const base = { id: c.id.trim(), label: c.label };
        if (c.ending)
          return c.outcome.trim()
            ? { ...base, ending: true, outcome: c.outcome.trim() }
            : { ...base, ending: true };
        return { ...base, to: c.target };
      }),
    };
  }
  return { startId: d.startId, nodes };
}

function nextId(prefix: string, used: Set<string>): string {
  let n = used.size + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export function emptyScenario(): ScenarioDraft {
  const d: ScenarioDraft = { startId: 'start', nodes: [] };
  d.nodes.push({
    uid: uid('node'),
    id: 'start',
    speaker: '',
    text: '',
    choices: [],
  });
  return addChoice(d, d.nodes[0].uid, { ending: true });
}

export function addNode(d: ScenarioDraft): ScenarioDraft {
  const used = new Set(d.nodes.map((n) => n.id));
  const node: NodeDraft = {
    uid: uid('node'),
    id: nextId('node', used),
    speaker: '',
    text: '',
    choices: [],
  };
  return {
    ...d,
    startId: d.startId || node.id,
    nodes: [...d.nodes, node],
  };
}

/** Remove a node; choices that pointed at it become dangling ('' target). */
export function removeNode(d: ScenarioDraft, nodeUid: string): ScenarioDraft {
  const gone = d.nodes.find((n) => n.uid === nodeUid);
  if (!gone) return d;
  const nodes = d.nodes
    .filter((n) => n.uid !== nodeUid)
    .map((n) => ({
      ...n,
      choices: n.choices.map((c) =>
        c.target === gone.id ? { ...c, target: '' } : c,
      ),
    }));
  return {
    startId: d.startId === gone.id ? (nodes[0]?.id ?? '') : d.startId,
    nodes,
  };
}

/** Change a node's id and re-point every choice / the start id at it. */
export function renameNode(
  d: ScenarioDraft,
  nodeUid: string,
  newId: string,
): ScenarioDraft {
  const node = d.nodes.find((n) => n.uid === nodeUid);
  if (!node) return d;
  const old = node.id;
  return {
    startId: d.startId === old ? newId : d.startId,
    nodes: d.nodes.map((n) => ({
      ...(n.uid === nodeUid ? { ...n, id: newId } : n),
      choices: n.choices.map((c) =>
        c.target === old ? { ...c, target: newId } : c,
      ),
    })),
  };
}

export function addChoice(
  d: ScenarioDraft,
  nodeUid: string,
  opts: { ending?: boolean } = {},
): ScenarioDraft {
  return {
    ...d,
    nodes: d.nodes.map((n) => {
      if (n.uid !== nodeUid) return n;
      const used = new Set(n.choices.map((c) => c.id));
      const choice: ChoiceDraft = {
        uid: uid('choice'),
        id: nextId('c', used),
        label: '',
        target: '',
        ending: !!opts.ending,
        outcome: '',
      };
      return { ...n, choices: [...n.choices, choice] };
    }),
  };
}

export function removeChoice(
  d: ScenarioDraft,
  nodeUid: string,
  choiceUid: string,
): ScenarioDraft {
  return {
    ...d,
    nodes: d.nodes.map((n) =>
      n.uid === nodeUid
        ? { ...n, choices: n.choices.filter((c) => c.uid !== choiceUid) }
        : n,
    ),
  };
}

/** Node ids not reachable from the start node (client-side hint). */
export function unreachableNodeIds(d: ScenarioDraft): string[] {
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const queue = byId.has(d.startId) ? [d.startId] : [];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (seen.has(id)) continue;
    seen.add(id);
    for (const c of byId.get(id)?.choices ?? []) {
      if (!c.ending && c.target && byId.has(c.target)) queue.push(c.target);
    }
  }
  return d.nodes.map((n) => n.id).filter((id) => !seen.has(id));
}

/** Duplicate node ids (the graph is keyed by id, so these would collide). */
export function duplicateNodeIds(d: ScenarioDraft): string[] {
  const counts = new Map<string, number>();
  for (const n of d.nodes) counts.set(n.id, (counts.get(n.id) ?? 0) + 1);
  return [...counts].filter(([, c]) => c > 1).map(([id]) => id);
}

/** Same rules the API applies (`validateScenario` from @codify/domain). */
export function scenarioProblems(d: ScenarioDraft): string[] {
  const dupes = duplicateNodeIds(d).map((id) => `duplicate node id "${id}"`);
  return [...dupes, ...validateScenario(draftToGraph(d))];
}
