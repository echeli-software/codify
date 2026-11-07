import type { Meta, StoryObj } from '@storybook/angular';
import {
  AiPromptPlayground,
  type AiCriterionView,
  type AiPromptView,
} from './ai-prompt-playground.js';

const PROMPT: AiPromptView = {
  promptText:
    'Write a prompt that asks an LLM to summarise a pull request for a non-technical stakeholder.',
  contextText: 'Mention audience, length and tone.',
  passThreshold: 70,
  maxAttempts: 5,
  attemptsUsed: 1,
  rubric: [
    { id: 'aud', label: 'States the audience', weight: 40 },
    { id: 'len', label: 'Sets a length limit', weight: 30 },
    { id: 'tone', label: 'Specifies a tone', weight: 30 },
  ],
};

const PARTIAL: AiCriterionView[] = [
  { id: 'aud', label: 'States the audience', weight: 40, passed: true },
  {
    id: 'len',
    label: 'Sets a length limit',
    weight: 30,
    passed: false,
    detail: 'No word or sentence limit found.',
  },
  { id: 'tone', label: 'Specifies a tone', weight: 30, passed: true },
];

const meta: Meta<AiPromptPlayground> = {
  title: 'Organisms/AiPromptPlayground',
  component: AiPromptPlayground,
  args: { prompt: PROMPT, response: '' },
};
export default meta;
type Story = StoryObj<AiPromptPlayground>;

export const Empty: Story = {};
export const Loading: Story = { args: { loading: true } };
export const Grading: Story = {
  args: {
    response: 'Summarise this PR for our product manager…',
    submitting: true,
  },
};
export const KeepGoing: Story = {
  args: {
    response: 'Summarise this PR for our product manager in a friendly tone.',
    results: PARTIAL,
    scorePct: 70,
    passed: false,
  },
};
export const Passed: Story = {
  args: {
    response:
      'Summarise this PR for our product manager in under 100 words, friendly tone.',
    results: PARTIAL.map((r) => ({ ...r, passed: true, detail: undefined })),
    scorePct: 100,
    passed: true,
    cached: true,
  },
};
export const OutOfAttempts: Story = {
  args: { prompt: { ...PROMPT, attemptsUsed: 5 }, response: 'Another try' },
};
