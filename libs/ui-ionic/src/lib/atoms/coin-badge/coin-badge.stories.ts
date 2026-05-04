import type { Meta, StoryObj } from '@storybook/angular';
import { CoinBadge } from './coin-badge.js';

const meta: Meta<CoinBadge> = {
  title: 'Atoms/CoinBadge',
  component: CoinBadge,
  argTypes: {
    value: { control: 'number' },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    tone: { control: 'select', options: ['plain', 'gain', 'large'] },
    compact: { control: 'boolean' },
    showLabel: { control: 'boolean' },
  },
  render: (args) => ({
    props: args,
    template: `<cdf-coin-badge [value]="value" [size]="size" [tone]="tone" [compact]="compact" [showLabel]="showLabel" />`,
  }),
};
export default meta;
type Story = StoryObj<CoinBadge>;

export const Default: Story = { args: { value: 320, size: 'md', tone: 'plain' } };
export const Gain: Story = { args: { value: 25, size: 'md', tone: 'gain' } };
export const LargeReward: Story = { args: { value: 250, size: 'lg', tone: 'large' } };
export const Compact: Story = { args: { value: 12500, size: 'md', compact: true } };

export const Sizes: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:16px; align-items:center;">
        <cdf-coin-badge [value]="320" size="sm" />
        <cdf-coin-badge [value]="320" size="md" />
        <cdf-coin-badge [value]="320" size="lg" />
      </div>
    `,
  }),
};
