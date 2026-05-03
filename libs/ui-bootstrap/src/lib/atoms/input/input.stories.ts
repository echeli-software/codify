import type { Meta, StoryObj } from '@storybook/angular';
import { Input } from './input.js';

const meta: Meta<Input> = {
  title: 'Atoms/Input',
  component: Input,
  argTypes: {
    type: { control: 'select', options: ['text', 'email', 'url', 'password', 'search', 'tel', 'number'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    invalid: { control: 'boolean' },
    readonly: { control: 'boolean' },
    placeholder: { control: 'text' },
  },
};
export default meta;
type Story = StoryObj<Input>;

export const Default: Story = { args: { placeholder: 'Type here…' } };
export const Invalid: Story = { args: { invalid: true, placeholder: 'Looks wrong' } };
export const Readonly: Story = { args: { readonly: true, placeholder: 'Read-only' } };

export const AllSizes: Story = {
  render: () => ({
    template: `
      <div style="display:flex; flex-direction:column; gap:8px; max-width:320px;">
        <cdf-input size="sm" placeholder="Small" />
        <cdf-input size="md" placeholder="Medium" />
        <cdf-input size="lg" placeholder="Large" />
      </div>
    `,
  }),
};
