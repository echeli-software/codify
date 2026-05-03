import type { Meta, StoryObj } from '@storybook/angular';
import { Spinner } from './spinner.js';

const meta: Meta<Spinner> = {
  title: 'Atoms/Spinner',
  component: Spinner,
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    label: { control: 'text' },
  },
};
export default meta;
type Story = StoryObj<Spinner>;

export const Default: Story = { args: { size: 'md', label: 'Loading…' } };

export const AllSizes: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:24px; align-items:center;">
        <cdf-spinner size="sm" label="Loading" />
        <cdf-spinner size="md" label="Loading" />
        <cdf-spinner size="lg" label="Loading" />
      </div>
    `,
  }),
};
