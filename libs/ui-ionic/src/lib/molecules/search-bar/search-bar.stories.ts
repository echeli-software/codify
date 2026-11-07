import type { Meta, StoryObj } from '@storybook/angular';
import { SearchBar } from './search-bar.js';

const meta: Meta<SearchBar> = {
  title: 'Molecules/SearchBar',
  component: SearchBar,
  argTypes: {
    debounceMs: { control: 'number' },
    voice: { control: 'boolean' },
  },
};
export default meta;
type Story = StoryObj<SearchBar>;

export const Default: Story = { args: { placeholder: 'Search courses' } };
export const WithValue: Story = {
  args: { value: 'react hooks', placeholder: 'Search courses' },
};
/** Mic button appears only where the Web Speech API exists (Chrome, WebView). */
export const WithVoice: Story = {
  args: { voice: true, placeholder: 'Search or speak' },
};
export const DefaultPlaceholder: Story = { args: {} };
