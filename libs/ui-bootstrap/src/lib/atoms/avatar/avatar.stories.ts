import type { Meta, StoryObj } from '@storybook/angular';
import { Avatar } from './avatar.js';

const meta: Meta<Avatar> = {
  title: 'Atoms/Avatar',
  component: Avatar,
  argTypes: {
    name: { control: 'text' },
    src: { control: 'text' },
    size: { control: 'select', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
  },
};
export default meta;
type Story = StoryObj<Avatar>;

export const InitialsFallback: Story = { args: { name: 'Maria Souza', size: 'md' } };

export const AllSizes: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:12px; align-items:center;">
        <cdf-avatar name="Maria Souza" size="xs" />
        <cdf-avatar name="Maria Souza" size="sm" />
        <cdf-avatar name="Maria Souza" size="md" />
        <cdf-avatar name="Maria Souza" size="lg" />
        <cdf-avatar name="Maria Souza" size="xl" />
      </div>
    `,
  }),
};

export const DeterministicHues: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
        <cdf-avatar name="Ana Pereira" />
        <cdf-avatar name="João Silva" />
        <cdf-avatar name="Lucas Karlsson" />
        <cdf-avatar name="Priya Mehta" />
        <cdf-avatar name="Wei Zhang" />
      </div>
    `,
  }),
};
