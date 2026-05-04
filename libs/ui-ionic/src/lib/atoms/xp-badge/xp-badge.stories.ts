import type { Meta, StoryObj } from '@storybook/angular';
import { XpBadge } from './xp-badge.js';

const meta: Meta<XpBadge> = {
  title: 'Atoms/XpBadge',
  component: XpBadge,
  argTypes: {
    value: { control: 'number' },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    tone: { control: 'select', options: ['plain', 'gain', 'large'] },
    showLabel: { control: 'boolean' },
  },
  render: (args) => ({
    props: args,
    template: `<cdf-xp-badge [value]="value" [size]="size" [tone]="tone" [showLabel]="showLabel" />`,
  }),
};
export default meta;
type Story = StoryObj<XpBadge>;

export const Default: Story = { args: { value: 1750, size: 'md' } };
export const Gain: Story = { args: { value: 25, size: 'md', tone: 'gain' } };
export const LargeReward: Story = { args: { value: 200, size: 'lg', tone: 'large' } };
