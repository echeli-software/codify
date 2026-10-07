import type { Meta, StoryObj } from '@storybook/angular';
import { AppAvatar } from './app-avatar.js';

const meta: Meta<AppAvatar> = {
  title: 'Atoms/AppAvatar',
  component: AppAvatar,
  argTypes: {
    size: { control: 'inline-radio', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
  },
  args: { name: 'Maria Souza', size: 'md', src: null },
};
export default meta;
type Story = StoryObj<AppAvatar>;

export const Initials: Story = {};
export const AllSizes: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:12px; align-items:center">
        <cdf-app-avatar name="Ana Lima" size="xs" />
        <cdf-app-avatar name="Bruno Reis" size="sm" />
        <cdf-app-avatar name="Carla Dias" size="md" />
        <cdf-app-avatar name="Diego Melo" size="lg" />
        <cdf-app-avatar name="Elisa Rocha" size="xl" />
      </div>`,
  }),
};
export const EmptyName: Story = { args: { name: '' } };
