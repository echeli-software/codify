import type { Meta, StoryObj } from '@storybook/angular';
import { StreakWidget, type StreakDay } from './streak-widget.js';

const WEEK: StreakDay[] = [
  { date: '2026-04-26', completed: true },
  { date: '2026-04-27', completed: true },
  { date: '2026-04-28', completed: false, frozen: true },
  { date: '2026-04-29', completed: true },
  { date: '2026-04-30', completed: true },
  { date: '2026-05-01', completed: true },
  { date: '2026-05-02', completed: true },
];

const meta: Meta<StreakWidget> = {
  title: 'Organisms/StreakWidget',
  component: StreakWidget,
  render: (args) => ({
    props: args,
    template: `
      <cdf-streak-widget
        [currentDays]="currentDays"
        [freezes]="freezes"
        [week]="week"
      />
    `,
  }),
};
export default meta;
type Story = StoryObj<StreakWidget>;

export const Active: Story = { args: { currentDays: 12, freezes: 2, week: WEEK } };
export const NoFreezes: Story = { args: { currentDays: 4, freezes: 0, week: WEEK } };
export const ColdStart: Story = {
  args: {
    currentDays: 0,
    freezes: 0,
    week: WEEK.map((d) => ({ ...d, completed: false, frozen: false })),
  },
};
