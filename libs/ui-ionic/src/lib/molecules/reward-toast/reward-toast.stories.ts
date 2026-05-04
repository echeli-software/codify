import type { Meta, StoryObj } from '@storybook/angular';
import { RewardToast } from './reward-toast.js';

const meta: Meta<RewardToast> = {
  title: 'Molecules/RewardToast',
  component: RewardToast,
  argTypes: {
    xp: { control: 'number' },
    coins: { control: 'number' },
    multiplier: { control: 'number' },
    tone: { control: 'select', options: ['plain', 'level-up'] },
  },
  render: (args) => ({
    props: args,
    template: `<cdf-reward-toast [xp]="xp" [coins]="coins" [multiplier]="multiplier" [tone]="tone" />`,
  }),
};
export default meta;
type Story = StoryObj<RewardToast>;

export const SmallReward: Story = { args: { xp: 20, coins: 10 } };
export const Multiplier: Story = { args: { xp: 40, coins: 20, multiplier: 2 } };
export const LevelUp: Story = { args: { xp: 200, coins: 50, tone: 'level-up' } };
