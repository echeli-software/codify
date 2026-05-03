import type { Meta, StoryObj } from '@storybook/angular';
import { ProgressBar } from './progress-bar.js';

const meta: Meta<ProgressBar> = {
  title: 'Atoms/ProgressBar',
  component: ProgressBar,
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 100 } },
    variant: { control: 'select', options: ['primary', 'success', 'warning', 'danger', 'xp'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    indeterminate: { control: 'boolean' },
    label: { control: 'text' },
  },
};
export default meta;
type Story = StoryObj<ProgressBar>;

export const Default: Story = { args: { value: 65, variant: 'primary', size: 'md' } };
export const XpBar: Story = { args: { value: 35, variant: 'xp', size: 'lg', label: 'XP toward next level' } };
export const Indeterminate: Story = { args: { indeterminate: true, label: 'Saving…' } };

export const AllVariants: Story = {
  render: () => ({
    template: `
      <div style="display:flex; flex-direction:column; gap:12px; max-width:480px;">
        <cdf-progress-bar [value]="80" variant="primary" />
        <cdf-progress-bar [value]="65" variant="success" />
        <cdf-progress-bar [value]="40" variant="warning" />
        <cdf-progress-bar [value]="20" variant="danger" />
        <cdf-progress-bar [value]="50" variant="xp" size="lg" />
      </div>
    `,
  }),
};
