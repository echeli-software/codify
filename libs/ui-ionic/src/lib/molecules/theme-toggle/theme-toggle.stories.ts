import type { Meta, StoryObj } from '@storybook/angular';
import { ThemeToggle } from './theme-toggle.js';

const meta: Meta<ThemeToggle> = {
  title: 'Molecules/ThemeToggle',
  component: ThemeToggle,
};
export default meta;
type Story = StoryObj<ThemeToggle>;

export const Default: Story = {};
