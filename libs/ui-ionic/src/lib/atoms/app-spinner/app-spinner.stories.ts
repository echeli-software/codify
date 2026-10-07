import type { Meta, StoryObj } from '@storybook/angular';
import { AppSpinner } from './app-spinner.js';

const meta: Meta<AppSpinner> = {
  title: 'Atoms/AppSpinner',
  component: AppSpinner,
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    variant: {
      control: 'inline-radio',
      options: ['crescent', 'dots', 'lines'],
    },
  },
  args: { size: 'md', variant: 'crescent' },
};
export default meta;
type Story = StoryObj<AppSpinner>;

export const Default: Story = {};
export const CustomLabel: Story = {
  args: { label: 'Saving your progress', variant: 'dots' },
};
export const Sizes: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:16px; align-items:center">
        <cdf-app-spinner size="sm" />
        <cdf-app-spinner size="md" variant="dots" />
        <cdf-app-spinner size="lg" variant="lines" />
      </div>`,
  }),
};
