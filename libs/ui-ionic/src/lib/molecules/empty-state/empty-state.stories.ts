import type { Meta, StoryObj } from '@storybook/angular';
import { EmptyState } from './empty-state.js';

const meta: Meta<EmptyState> = {
  title: 'Molecules/EmptyState',
  component: EmptyState,
  argTypes: {
    icon: { control: 'text' },
    title: { control: 'text' },
    description: { control: 'text' },
  },
  render: (args) => ({
    props: args,
    template: `
      <cdf-empty-state [icon]="icon" [title]="title" [description]="description">
      </cdf-empty-state>
    `,
  }),
};
export default meta;
type Story = StoryObj<EmptyState>;

export const Default: Story = {
  args: {
    icon: 'search',
    title: 'No results',
    description: 'Try a different search term to find what you are looking for.',
  },
};
