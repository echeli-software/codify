import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { Input } from '../../atoms/input/input.js';
import { Textarea } from '../../atoms/textarea/textarea.js';
import { FormField } from './form-field.js';

const meta: Meta<FormField> = {
  title: 'Molecules/FormField',
  component: FormField,
  decorators: [moduleMetadata({ imports: [FormField, Input, Textarea] })],
  argTypes: {
    label: { control: 'text' },
    help: { control: 'text' },
    error: { control: 'text' },
    required: { control: 'boolean' },
  },
};
export default meta;
type Story = StoryObj<FormField>;

export const Default: Story = {
  args: { label: 'Display name', help: 'Shown to other learners.', required: true },
  render: (args) => ({
    props: args,
    template: `
      <cdf-form-field [label]="label" [help]="help" [error]="error" [required]="required">
        <cdf-input placeholder="e.g. Maria Souza" />
      </cdf-form-field>
    `,
  }),
};

export const WithError: Story = {
  args: { label: 'Email', error: 'Looks invalid', required: true },
  render: (args) => ({
    props: args,
    template: `
      <cdf-form-field [label]="label" [error]="error" [required]="required">
        <cdf-input type="email" [invalid]="!!error" placeholder="you@example.com" />
      </cdf-form-field>
    `,
  }),
};

export const WithTextarea: Story = {
  args: { label: 'Bio', help: 'Optional. Markdown supported.' },
  render: (args) => ({
    props: args,
    template: `
      <cdf-form-field [label]="label" [help]="help">
        <cdf-textarea [rows]="3" placeholder="A short blurb…" />
      </cdf-form-field>
    `,
  }),
};
