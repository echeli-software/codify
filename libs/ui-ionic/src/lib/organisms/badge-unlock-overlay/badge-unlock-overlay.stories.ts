import type { Meta, StoryObj } from '@storybook/angular';
import { BadgeUnlockOverlay } from './badge-unlock-overlay.js';

const meta: Meta<BadgeUnlockOverlay> = {
  title: 'Organisms/BadgeUnlockOverlay',
  component: BadgeUnlockOverlay,
  argTypes: {
    name: { control: 'text' },
    icon: { control: 'text' },
    description: { control: 'text' },
  },
  render: (args) => ({
    props: args,
    template: `
      <cdf-badge-unlock-overlay
        [open]="true"
        [name]="name"
        [icon]="icon"
        [description]="description"
      />
    `,
  }),
};
export default meta;
type Story = StoryObj<BadgeUnlockOverlay>;

export const WeekStreak: Story = {
  args: {
    name: 'Week Warrior',
    icon: 'flame',
    description: 'Held a 7-day learning streak.',
  },
};
export const FirstLesson: Story = {
  args: {
    name: 'First Steps',
    icon: 'rocket',
    description: 'Completed your very first lesson.',
  },
};
export const Trophy: Story = {
  args: {
    name: 'Top of the Class',
    icon: 'trophy',
    description: 'Finished in the top 3 of your league.',
  },
};
