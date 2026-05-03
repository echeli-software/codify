import type { Meta, StoryObj } from '@storybook/angular';
import { SearchBar } from './search-bar.js';

const meta: Meta<SearchBar> = {
  title: 'Molecules/SearchBar',
  component: SearchBar,
  argTypes: {
    placeholder: { control: 'text' },
    debounceMs: { control: { type: 'number', min: 0, max: 1000, step: 50 } },
  },
};
export default meta;
type Story = StoryObj<SearchBar>;

export const Default: Story = {
  args: { placeholder: 'Search courses, lessons, items…', debounceMs: 250 },
};
