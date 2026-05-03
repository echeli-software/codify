import type { Meta, StoryObj } from '@storybook/angular';
import { Checkbox } from './checkbox.js';

const meta: Meta<Checkbox> = {
  title: 'Atoms/Checkbox',
  component: Checkbox,
  argTypes: {
    label: { control: 'text' },
  },
};
export default meta;
type Story = StoryObj<Checkbox>;

export const Default: Story = { args: { label: 'I accept the terms' } };

export const Group: Story = {
  render: () => ({
    template: `
      <div style="display:flex; flex-direction:column; gap:8px;">
        <cdf-checkbox label="Send me weekly digests" />
        <cdf-checkbox label="Notify me on streak milestones" />
        <cdf-checkbox label="Marketing emails" />
      </div>
    `,
  }),
};
