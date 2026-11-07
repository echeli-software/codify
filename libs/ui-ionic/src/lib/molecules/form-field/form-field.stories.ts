import type { Meta, StoryObj } from '@storybook/angular';
import { FormField } from './form-field.js';

const meta: Meta<FormField> = {
  title: 'Molecules/FormField',
  component: FormField,
};
export default meta;
type Story = StoryObj<FormField>;

export const WithHelp: Story = {
  render: () => ({
    template: `
      <cdf-form-field label="Display name" help="Shown on leaderboards." controlId="sb-ff-name">
        <input id="sb-ff-name" aria-describedby="sb-ff-name-help" style="width:100%; padding:8px" value="Maria" />
      </cdf-form-field>`,
  }),
};
export const Required: Story = {
  render: () => ({
    template: `
      <cdf-form-field label="Email" [required]="true" controlId="sb-ff-email">
        <input id="sb-ff-email" type="email" style="width:100%; padding:8px" />
      </cdf-form-field>`,
  }),
};
export const WithError: Story = {
  render: () => ({
    template: `
      <cdf-form-field label="Email" error="Enter a valid email." controlId="sb-ff-err">
        <input id="sb-ff-err" type="email" aria-invalid="true" aria-describedby="sb-ff-err-error" style="width:100%; padding:8px" value="maria@" />
      </cdf-form-field>`,
  }),
};
