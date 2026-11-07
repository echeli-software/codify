import type { Meta, StoryObj } from '@storybook/angular';
import {
  ExerciseRunner,
  type ExerciseTestView,
  type ExerciseView,
} from './exercise-runner.js';

const EX: ExerciseView = {
  language: 'javascript',
  entryFunction: 'sum',
  starterCode: 'function sum(a, b) {\n  // your code here\n}\n',
};

const MIXED: ExerciseTestView[] = [
  { id: 't1', name: 'adds positives', passed: true },
  { id: 't2', name: 'adds negatives', passed: false, actual: 1, expected: -3 },
  {
    id: 't3',
    name: 'handles strings',
    passed: false,
    error: 'TypeError: b is undefined',
  },
];

const meta: Meta<ExerciseRunner> = {
  title: 'Organisms/ExerciseRunner',
  component: ExerciseRunner,
  args: { exercise: EX, code: EX.starterCode },
};
export default meta;
type Story = StoryObj<ExerciseRunner>;

export const Fresh: Story = {};
export const Loading: Story = { args: { loading: true } };
export const Running: Story = { args: { running: true } };
export const SomeFailing: Story = {
  args: {
    code: 'function sum(a, b) {\n  return a + 1;\n}\n',
    results: MIXED,
    verdict: 'FAIL',
    scorePct: 33,
  },
};
export const Solved: Story = {
  args: {
    code: 'function sum(a, b) {\n  return a + b;\n}\n',
    results: MIXED.map((t) => ({ ...t, passed: true, error: undefined })),
    verdict: 'PASS',
    scorePct: 100,
    passed: true,
  },
};
export const RateLimited: Story = {
  args: { error: 'Slow down — one submission every few seconds.' },
};
