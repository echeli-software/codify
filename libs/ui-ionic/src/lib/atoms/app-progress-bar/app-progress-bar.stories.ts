import type { Meta, StoryObj } from '@storybook/angular';
import { AppProgressBar } from './app-progress-bar.js';

const meta: Meta<AppProgressBar> = {
  title: 'Atoms/AppProgressBar',
  component: AppProgressBar,
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 100 } },
    variant: {
      control: 'select',
      options: ['primary', 'success', 'warning', 'danger', 'xp'],
    },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
  args: { value: 60, variant: 'primary', size: 'md', label: 'Course progress' },
};
export default meta;
type Story = StoryObj<AppProgressBar>;

export const Default: Story = {};
export const Indeterminate: Story = {
  args: { indeterminate: true, label: 'Syncing' },
};
export const AllVariants: Story = {
  render: () => ({
    template: `
      <div style="display:flex; flex-direction:column; gap:12px; max-width:420px">
        <cdf-app-progress-bar [value]="80" variant="primary" label="Primary" />
        <cdf-app-progress-bar [value]="65" variant="success" label="Success" />
        <cdf-app-progress-bar [value]="40" variant="warning" label="Warning" />
        <cdf-app-progress-bar [value]="20" variant="danger" label="Danger" />
        <cdf-app-progress-bar [value]="50" variant="xp" size="lg" label="XP" />
      </div>`,
  }),
};
