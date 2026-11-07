import type { Meta, StoryObj } from '@storybook/angular';
import { ScenarioRunner, type ScenarioGraphView } from './scenario-runner.js';

const GRAPH: ScenarioGraphView = {
  startId: 'n1',
  nodes: {
    n1: {
      id: 'n1',
      speaker: 'Teammate',
      text: 'Your PR broke the build an hour before the release. What do you say?',
      choices: [
        {
          id: 'c1',
          label: 'Sorry! Reverting now and I will investigate.',
          to: 'n2',
        },
        { id: 'c2', label: 'It passed on my machine.', to: 'n3' },
      ],
    },
    n2: {
      id: 'n2',
      speaker: 'Teammate',
      text: 'Thanks — that unblocks us. Want to pair on the fix?',
      choices: [
        {
          id: 'c3',
          label: 'Yes, let us pair after lunch.',
          ending: true,
          outcome: 'Ownership',
        },
      ],
    },
    n3: {
      id: 'n3',
      speaker: 'Teammate',
      text: 'That does not help the release…',
      choices: [
        {
          id: 'c4',
          label: 'Fair. I will revert.',
          ending: true,
          outcome: 'Recovered',
        },
      ],
    },
  },
};

const meta: Meta<ScenarioRunner> = {
  title: 'Organisms/ScenarioRunner',
  component: ScenarioRunner,
  args: { graph: GRAPH },
};
export default meta;
type Story = StoryObj<ScenarioRunner>;

export const Start: Story = {};
export const Loading: Story = { args: { loading: true } };
export const Recording: Story = { args: { recording: true } };
export const WithOutcome: Story = { args: { outcome: 'Ownership' } };
export const RecordError: Story = {
  args: { error: 'Could not record this scenario.' },
};
