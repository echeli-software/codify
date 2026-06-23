import { scenarioMaxDepth, validateScenario, walkScenario, type ScenarioGraph } from './scenarios.js';

// start → (a) mid → (x) end[resolved] | (y) end[escalated]
//       → (b) end[bailed]
const graph: ScenarioGraph = {
  startId: 'start',
  nodes: {
    start: {
      id: 'start',
      speaker: 'Customer',
      text: 'My order never arrived.',
      choices: [
        { id: 'a', label: 'Apologise and investigate', to: 'mid' },
        { id: 'b', label: 'Blame the courier', ending: true, outcome: 'bailed' },
      ],
    },
    mid: {
      id: 'mid',
      speaker: 'Customer',
      text: 'Okay, what now?',
      choices: [
        { id: 'x', label: 'Offer a refund', ending: true, outcome: 'resolved' },
        { id: 'y', label: 'Argue', ending: true, outcome: 'escalated' },
      ],
    },
  },
};

describe('validateScenario', () => {
  it('accepts a well-formed graph', () => {
    expect(validateScenario(graph)).toEqual([]);
  });

  it('flags a missing start node', () => {
    expect(validateScenario({ startId: 'nope', nodes: graph.nodes })).toContain('start node is missing');
  });

  it('flags a dangling choice target', () => {
    const broken: ScenarioGraph = { startId: 'start', nodes: { start: { id: 'start', text: 'hi', choices: [{ id: 'a', label: 'go', to: 'ghost' }] } } };
    expect(validateScenario(broken).some((e) => e.includes('missing node'))).toBe(true);
  });

  it('flags a graph with no ending', () => {
    const loop: ScenarioGraph = { startId: 's', nodes: { s: { id: 's', text: 'x', choices: [{ id: 'a', label: 'self', to: 's' }] } } };
    expect(validateScenario(loop)).toContain('scenario has no ending');
  });
});

describe('walkScenario', () => {
  it('walks a 2-deep path to an ending and records the outcome', () => {
    const r = walkScenario(graph, ['a', 'x']);
    expect(r.valid).toBe(true);
    expect(r.completed).toBe(true);
    expect(r.depth).toBe(2);
    expect(r.outcome).toBe('resolved');
    expect(r.path).toEqual(['start', 'mid']);
  });

  it('a one-step ending choice completes immediately', () => {
    const r = walkScenario(graph, ['b']);
    expect(r.completed).toBe(true);
    expect(r.depth).toBe(1);
    expect(r.outcome).toBe('bailed');
  });

  it('rejects an invalid choice id', () => {
    const r = walkScenario(graph, ['a', 'zzz']);
    expect(r.valid).toBe(false);
    expect(r.completed).toBe(false);
  });

  it('an incomplete path is valid but not completed', () => {
    const r = walkScenario(graph, ['a']);
    expect(r.valid).toBe(true);
    expect(r.completed).toBe(false);
    expect(r.depth).toBe(1);
  });
});

describe('scenarioMaxDepth', () => {
  it('reports the longest branch (2 here)', () => {
    expect(scenarioMaxDepth(graph)).toBe(2);
  });

  it('is cycle-safe', () => {
    const loop: ScenarioGraph = {
      startId: 's',
      nodes: {
        s: { id: 's', text: 'x', choices: [{ id: 'a', label: 'loop', to: 's' }, { id: 'b', label: 'end', ending: true }] },
      },
    };
    expect(scenarioMaxDepth(loop)).toBe(1);
  });
});
