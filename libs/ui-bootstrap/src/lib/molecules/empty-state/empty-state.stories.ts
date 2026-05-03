import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { Button } from '../../atoms/button/button.js';
import { Icon } from '../../atoms/icon/icon.js';
import { EmptyState } from './empty-state.js';

const meta: Meta<EmptyState> = {
  title: 'Molecules/EmptyState',
  component: EmptyState,
  decorators: [moduleMetadata({ imports: [EmptyState, Button, Icon] })],
  argTypes: {
    icon: { control: 'select', options: ['plus', 'search', 'pencil', 'gear'] },
    title: { control: 'text' },
    description: { control: 'text' },
  },
};
export default meta;
type Story = StoryObj<EmptyState>;

export const Default: Story = {
  args: {
    icon: 'plus',
    title: 'No courses yet',
    description: 'Start by creating your first course. You can add modules and lessons after.',
  },
  render: (args) => ({
    props: args,
    template: `
      <cdf-empty-state [icon]="icon" [title]="title" [description]="description">
        <cdf-button kind="primary"><cdf-icon name="plus" size="sm" /> New course</cdf-button>
        <cdf-button kind="ghost">Browse templates</cdf-button>
      </cdf-empty-state>
    `,
  }),
};

export const SearchEmpty: Story = {
  args: {
    icon: 'search',
    title: 'No matches',
    description: 'Try a different search term, or clear the filter to see all results.',
  },
  render: (args) => ({
    props: args,
    template: `<cdf-empty-state [icon]="icon" [title]="title" [description]="description" />`,
  }),
};
