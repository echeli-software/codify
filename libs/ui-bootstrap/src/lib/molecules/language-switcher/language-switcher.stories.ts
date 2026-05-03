import type { Meta, StoryObj } from '@storybook/angular';
import { LanguageSwitcher } from './language-switcher.js';

const meta: Meta<LanguageSwitcher> = {
  title: 'Molecules/LanguageSwitcher',
  component: LanguageSwitcher,
};
export default meta;
type Story = StoryObj<LanguageSwitcher>;

export const Default: Story = {};
