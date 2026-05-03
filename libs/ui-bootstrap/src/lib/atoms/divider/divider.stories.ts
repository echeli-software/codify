import type { Meta, StoryObj } from '@storybook/angular';
import { Divider } from './divider.js';

const meta: Meta<Divider> = {
  title: 'Atoms/Divider',
  component: Divider,
  argTypes: {
    orientation: { control: 'select', options: ['horizontal', 'vertical'] },
    label: { control: 'text' },
    inset: { control: 'boolean' },
  },
};
export default meta;
type Story = StoryObj<Divider>;

export const Horizontal: Story = { args: { orientation: 'horizontal' } };
export const WithLabel: Story = { args: { orientation: 'horizontal', label: 'Section' } };

export const Vertical: Story = {
  render: () => ({
    template: `
      <div style="display:inline-flex; align-items:center; gap:8px; height:32px;">
        <span>Left</span>
        <cdf-divider orientation="vertical" />
        <span>Right</span>
      </div>
    `,
  }),
};
