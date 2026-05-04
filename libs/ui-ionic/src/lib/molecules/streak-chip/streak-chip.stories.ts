import type { Meta, StoryObj } from '@storybook/angular';
import { StreakChip } from './streak-chip.js';

const meta: Meta<StreakChip> = {
  title: 'Molecules/StreakChip',
  component: StreakChip,
  argTypes: {
    days: { control: 'number' },
    freezes: { control: 'number' },
    showLabel: { control: 'boolean' },
  },
  render: (args) => ({
    props: args,
    template: `<cdf-streak-chip [days]="days" [freezes]="freezes" [showLabel]="showLabel" />`,
  }),
};
export default meta;
type Story = StoryObj<StreakChip>;

export const Starter: Story = { args: { days: 3, freezes: 0 } };
export const Week: Story = { args: { days: 12, freezes: 2 } };
export const Month: Story = { args: { days: 35, freezes: 1 } };
export const Century: Story = { args: { days: 120 } };
export const Year: Story = { args: { days: 400 } };
export const Cold: Story = { args: { days: 0, freezes: 1 } };
