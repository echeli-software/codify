import type { ScenarioGraph } from '@codify/api-client';
import {
  addChoice,
  addNode,
  draftToGraph,
  duplicateNodeIds,
  emptyScenario,
  graphToDraft,
  removeChoice,
  removeNode,
  renameNode,
  scenarioProblems,
  unreachableNodeIds,
} from './scenario-model';

const GRAPH: ScenarioGraph = {
  startId: 'start',
  nodes: {
    orphan: { id: 'orphan', text: 'Nobody gets here', choices: [] },
    mid: {
      id: 'mid',
      speaker: 'Customer',
      text: 'Okay, what now?',
      choices: [
        { id: 'x', label: 'Offer a refund', ending: true, outcome: 'resolved' },
        { id: 'y', label: 'Argue', ending: true },
      ],
    },
    start: {
      id: 'start',
      speaker: 'Customer',
      text: 'My order never arrived!',
      choices: [
        { id: 'a', label: 'Apologise', to: 'mid' },
        {
          id: 'b',
          label: 'Blame the courier',
          ending: true,
          outcome: 'bailed',
        },
      ],
    },
  },
};

describe('scenario editor model', () => {
  it('converts graph → draft (start first, breadth-first) → the same graph', () => {
    const draft = graphToDraft(GRAPH);
    expect(draft.nodes.map((n) => n.id)).toEqual(['start', 'mid', 'orphan']);
    expect(draft.nodes[0].choices[0]).toMatchObject({
      target: 'mid',
      ending: false,
    });
    expect(draftToGraph(draft)).toEqual(GRAPH);
  });

  it('reports unreachable nodes and runs the API validation rules', () => {
    const draft = graphToDraft(GRAPH);
    expect(unreachableNodeIds(draft)).toEqual(['orphan']);
    expect(scenarioProblems(draft)).toEqual([]);
    const broken = { ...draft, startId: 'nope' };
    expect(scenarioProblems(broken)).toContain('start node is missing');
  });

  it('renames a node and re-points choices and the start id', () => {
    const draft = graphToDraft(GRAPH);
    const renamed = renameNode(draft, draft.nodes[1].uid, 'middle');
    const g = draftToGraph(renamed);
    expect(Object.keys(g.nodes)).toContain('middle');
    expect(g.nodes['start'].choices[0].to).toBe('middle');
    const startRenamed = renameNode(draft, draft.nodes[0].uid, 'begin');
    expect(startRenamed.startId).toBe('begin');
  });

  it('removing a node leaves dangling choices for validation to flag', () => {
    const draft = graphToDraft(GRAPH);
    const without = removeNode(draft, draft.nodes[1].uid);
    expect(without.nodes[0].choices[0].target).toBe('');
    expect(
      scenarioProblems(without).some((p) => p.includes('missing node')),
    ).toBe(true);
  });

  it('adds nodes and choices with fresh ids; duplicate ids are flagged', () => {
    let d = emptyScenario();
    expect(d.nodes[0].choices[0].ending).toBe(true);
    d = addNode(d);
    expect(d.nodes[1].id).toBe('node2');
    d = addChoice(d, d.nodes[0].uid);
    expect(d.nodes[0].choices.map((c) => c.id)).toEqual(['c1', 'c2']);
    d = removeChoice(d, d.nodes[0].uid, d.nodes[0].choices[1].uid);
    expect(d.nodes[0].choices).toHaveLength(1);
    const dup = renameNode(d, d.nodes[1].uid, 'start');
    expect(duplicateNodeIds(dup)).toEqual(['start']);
    expect(scenarioProblems(dup)[0]).toContain('duplicate node id');
  });

  it('ending choices drop the target; empty outcomes are omitted', () => {
    const d = emptyScenario();
    const g = draftToGraph(d);
    expect(g.nodes['start'].choices[0]).toEqual({
      id: 'c1',
      label: '',
      ending: true,
    });
  });
});
