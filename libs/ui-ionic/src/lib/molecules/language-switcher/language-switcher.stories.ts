import type { Meta, StoryObj } from '@storybook/angular';
import { LanguageSwitcher } from './language-switcher.js';

const meta: Meta<LanguageSwitcher> = {
  title: 'Molecules/LanguageSwitcher',
  component: LanguageSwitcher,
  argTypes: {
    interface: {
      control: 'inline-radio',
      options: ['popover', 'action-sheet', 'alert'],
    },
  },
};
export default meta;
type Story = StoryObj<LanguageSwitcher>;

export const WithLabel: Story = { args: { showLabel: true } };
export const Compact: Story = { args: { showLabel: false } };
