import { JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
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
  args: { options: OPTIONS, ariaLabel: 'Category' },
  decorators: [moduleMetadata({ imports: [FormsModule, JsonPipe] })],
};
export default meta;
type Story = StoryObj<Select<string>>;

export const Default: Story = {
  render: (args) => ({
    props: args,
    template: `<cdf-select [options]="options" [size]="size" [placeholder]="placeholder" [ariaLabel]="ariaLabel" />`,
  }),
};

export const WithPlaceholder: Story = {
  args: { placeholder: 'Pick a category' },
  render: (args) => ({
    props: args,
    template: `<cdf-select [options]="options" [placeholder]="placeholder" [ariaLabel]="ariaLabel" />`,
  }),
};

export const Invalid: Story = {
  args: { invalid: true, placeholder: 'Required' },
  render: (args) => ({
    props: args,
    template: `<cdf-select [options]="options" [invalid]="invalid" [placeholder]="placeholder" [ariaLabel]="ariaLabel" />`,
  }),
};

/** Multi-select: disclosure button + native checkboxes; value is an array. */
export const Multiple: Story = {
  render: (args) => ({
    props: { ...args, picked: ['frontend', 'ai'] },
    template: `
      <div style="max-width: 320px; min-height: 260px">
        <cdf-select [options]="options" [multiple]="true" [ariaLabel]="ariaLabel" [(ngModel)]="picked" />
        <p style="margin-top: 8px; font-size: 13px">Value: <code>{{ picked | json }}</code></p>
      </div>
    `,
  }),
};

export const MultipleEmpty: Story = {
  render: (args) => ({
    props: { ...args, picked: [] },
    template: `<div style="max-width: 320px"><cdf-select [options]="options" [multiple]="true" [ariaLabel]="ariaLabel" [(ngModel)]="picked" /></div>`,
  }),
};
