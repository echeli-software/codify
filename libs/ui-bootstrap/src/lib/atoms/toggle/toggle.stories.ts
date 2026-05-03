import type { Meta, StoryObj } from '@storybook/angular';
import { Toggle } from './toggle.js';

const meta: Meta<Toggle> = {
  title: 'Atoms/Toggle',
  component: Toggle,
  argTypes: { label: { control: 'text' } },
};
export default meta;
type Story = StoryObj<Toggle>;

export const Default: Story = { args: { label: 'Email notifications' } };
