import type { Meta, StoryObj } from '@storybook/angular';
import { XpBar } from './xp-bar.js';

const meta: Meta<XpBar> = {
  title: 'Molecules/XpBar',
  component: XpBar,
  argTypes: {
    xp: { control: 'number' },
    compact: { control: 'boolean' },
  },
  render: (args) => ({
    props: args,
    template: `<cdf-xp-bar [xp]="xp" [compact]="compact" />`,
  }),
};
export default meta;
type Story = StoryObj<XpBar>;

export const Default: Story = { args: { xp: 1750 } };
export const Beginner: Story = { args: { xp: 60 } };
export const HighLevel: Story = { args: { xp: 18500 } };
export const Compact: Story = { args: { xp: 1750, compact: true } };
