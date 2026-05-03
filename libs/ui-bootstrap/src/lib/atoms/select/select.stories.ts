import type { Meta, StoryObj } from '@storybook/angular';
import { Select, type SelectOption } from './select.js';

const OPTIONS: SelectOption<string>[] = [
  { value: 'frontend', label: 'Frontend' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'ai', label: 'AI usage' },
  { value: 'soft', label: 'Soft skills' },
];

const meta: Meta<Select<string>> = {
  title: 'Atoms/Select',
  component: Select,
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    invalid: { control: 'boolean' },
    placeholder: { control: 'text' },
  },
  args: { options: OPTIONS },
};
export default meta;
type Story = StoryObj<Select<string>>;

export const Default: Story = {
  render: (args) => ({
    props: args,
    template: `<cdf-select [options]="options" [size]="size" [placeholder]="placeholder" />`,
  }),
};

export const WithPlaceholder: Story = {
  args: { placeholder: 'Pick a category' },
  render: (args) => ({
    props: args,
    template: `<cdf-select [options]="options" [placeholder]="placeholder" />`,
  }),
};
