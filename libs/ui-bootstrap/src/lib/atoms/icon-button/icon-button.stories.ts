import type { Meta, StoryObj } from '@storybook/angular';
import { IconButton } from './icon-button.js';

const meta: Meta<IconButton> = {
  title: 'Atoms/IconButton',
  component: IconButton,
  argTypes: {
    icon: { control: 'select', options: ['plus', 'pencil', 'trash', 'gear', 'eye', 'x', 'search', 'moon', 'sun'] },
    kind: { control: 'select', options: ['primary', 'secondary', 'ghost', 'danger', 'link'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    pressed: { control: 'boolean' },
    disabled: { control: 'boolean' },
    ariaLabel: { control: 'text' },
  },
};
export default meta;
type Story = StoryObj<IconButton>;

export const Default: Story = {
  args: { icon: 'plus', ariaLabel: 'Add', kind: 'primary', size: 'md' },
};

export const AllVariants: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:8px; align-items:center;">
        <cdf-icon-button icon="plus" ariaLabel="Add" kind="primary" />
        <cdf-icon-button icon="pencil" ariaLabel="Edit" kind="secondary" />
        <cdf-icon-button icon="gear" ariaLabel="Settings" kind="ghost" />
        <cdf-icon-button icon="trash" ariaLabel="Delete" kind="danger" />
      </div>
    `,
  }),
};

export const Toggle: Story = {
  args: { icon: 'moon', ariaLabel: 'Toggle dark mode', kind: 'ghost', pressed: true },
};
