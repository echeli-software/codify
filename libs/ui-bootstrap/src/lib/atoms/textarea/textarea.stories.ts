import type { Meta, StoryObj } from '@storybook/angular';
import { Textarea } from './textarea.js';

const meta: Meta<Textarea> = {
  title: 'Atoms/Textarea',
  component: Textarea,
  argTypes: {
    rows: { control: { type: 'number', min: 1, max: 12 } },
    invalid: { control: 'boolean' },
    placeholder: { control: 'text' },
  },
};
export default meta;
type Story = StoryObj<Textarea>;

export const Default: Story = { args: { rows: 4, placeholder: 'A short blurb…' } };
export const Invalid: Story = { args: { invalid: true, rows: 4, placeholder: 'Looks wrong' } };
