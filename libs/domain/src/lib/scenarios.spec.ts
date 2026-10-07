import {
  reachableNodeIds,
  scenarioMaxDepth,
  validateScenario,
  walkScenario,
  type ScenarioGraph,
} from './scenarios.js';

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
        {
          id: 'b',
          label: 'Blame the courier',
          ending: true,
          outcome: 'bailed',
        },
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
    expect(validateScenario({ startId: 'nope', nodes: graph.nodes })).toContain(
      'start node is missing',
    );
  });

  it('flags a dangling choice target', () => {
    const broken: ScenarioGraph = {
      startId: 'start',
      nodes: {
        start: {
          id: 'start',
          text: 'hi',
          choices: [{ id: 'a', label: 'go', to: 'ghost' }],
        },
      },
    };
    expect(
      validateScenario(broken).some((e) => e.includes('missing node')),
    ).toBe(true);
  });

  it('flags a graph with no ending', () => {
    const loop: ScenarioGraph = {
      startId: 's',
      nodes: {
        s: {
          id: 's',
          text: 'x',
          choices: [{ id: 'a', label: 'self', to: 's' }],
        },
      },
    };
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
        s: {
          id: 's',
          text: 'x',
          choices: [
            { id: 'a', label: 'loop', to: 's' },
            { id: 'b', label: 'end', ending: true },
          ],
        },
      },
    };
    expect(scenarioMaxDepth(loop)).toBe(1);
  });
});

describe('validateScenario — hardening', () => {
  const withNodes = (extra: Record<string, unknown>): ScenarioGraph =>
    ({
      startId: 'start',
      nodes: { ...graph.nodes, ...extra },
    }) as unknown as ScenarioGraph;

  it('rejects a choiceless start node', () => {
    const g: ScenarioGraph = {
      startId: 's',
      nodes: { s: { id: 's', text: 'the end already', choices: [] } },
    };
    expect(validateScenario(g)).toContain('start node has no choices');
  });

  it('requires an ending reachable from the start', () => {
    const g: ScenarioGraph = {
      startId: 's',
      nodes: {
        s: {
          id: 's',
          text: 'loop',
          choices: [{ id: 'a', label: 'again', to: 's' }],
        },
        island: {
          id: 'island',
          text: 'unreachable',
          choices: [{ id: 'e', label: 'end', ending: true }],
        },
      },
    };
    expect(validateScenario(g)).toContain(
      'no ending is reachable from the start node',
    );
    expect(reachableNodeIds(g)).toEqual(new Set(['s']));
  });

  it('accepts a reachable choiceless terminal node as an ending', () => {
    const g: ScenarioGraph = {
      startId: 's',
      nodes: {
        s: {
          id: 's',
          text: 'go',
          choices: [{ id: 'a', label: 'next', to: 't' }],
        },
        t: { id: 't', text: 'fin', choices: [] },
      },
    };
    expect(validateScenario(g)).toEqual([]);
    expect(walkScenario(g, ['a']).completed).toBe(true);
  });

  it('does not resolve prototype keys as nodes', () => {
    const g = {
      startId: '__proto__',
      nodes: { ...graph.nodes },
    } as ScenarioGraph;
    expect(validateScenario(g)).toContain('start node is missing');
    const viaChoice: ScenarioGraph = {
      startId: 's',
      nodes: {
        s: {
          id: 's',
          text: 'x',
          choices: [
            { id: 'a', label: 'toString', to: 'toString' },
            { id: 'e', label: 'end', ending: true },
          ],
        },
      },
    };
    expect(
      validateScenario(viaChoice).some((e) => e.includes('missing node')),
    ).toBe(true);
    expect(walkScenario(viaChoice, ['a']).valid).toBe(false);
    expect(walkScenario({ startId: 'constructor', nodes: {} }, []).valid).toBe(
      false,
    );
  });

  it('rejects duplicate choice ids within a node', () => {
    const g = withNodes({
      mid: {
        id: 'mid',
        text: 'dup',
        choices: [
          { id: 'x', label: 'one', ending: true },
          { id: 'x', label: 'two', ending: true },
        ],
      },
    });
    expect(validateScenario(g)).toContain(
      'node "mid" has duplicate choice id "x"',
    );
  });

  it('rejects a node whose id does not match its key', () => {
    const g = withNodes({
      mid: {
        id: 'other',
        text: 'x',
        choices: [{ id: 'x', label: 'end', ending: true }],
      },
    });
    expect(validateScenario(g)).toContain(
      'node "mid" has mismatched id "other"',
    );
  });

  it('rejects non-object nodes and non-list choices', () => {
    const errors = validateScenario(
      withNodes({
        bad: 'nope',
        worse: { id: 'worse', text: 'x', choices: 'no' },
      }),
    );
    expect(errors).toContain('node "bad" is not an object');
    expect(errors).toContain('node "worse" choices must be a list');
  });
});
