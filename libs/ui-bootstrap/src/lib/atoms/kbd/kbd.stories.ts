import type { Meta, StoryObj } from '@storybook/angular';
import { Kbd } from './kbd.js';

const meta: Meta<Kbd> = {
  title: 'Atoms/Kbd',
  component: Kbd,
};
export default meta;
type Story = StoryObj<Kbd>;

export const SingleKey: Story = {
  render: () => ({
    template: `<cdf-kbd>K</cdf-kbd>`,
  }),
};

export const Chord: Story = {
  render: () => ({
    template: `Open command bar with <cdf-kbd>⌘</cdf-kbd> + <cdf-kbd>K</cdf-kbd>`,
  }),
};
