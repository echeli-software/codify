import type { Meta, StoryObj } from '@storybook/angular';
import { DailyQuestList, type DailyQuest } from './daily-quest-list.js';

const QUESTS: DailyQuest[] = [
  {
    id: 'q1',
    title: 'Complete 1 React lesson',
    progress: 0,
    target: 1,
    xpReward: 25,
    coinReward: 10,
    kind: 'lesson-count',
  },
  {
    id: 'q2',
    title: 'Earn 100 XP today',
    progress: 60,
    target: 100,
    xpReward: 50,
    coinReward: 15,
    kind: 'xp-amount',
  },
  {
    id: 'q3',
    title: 'Pass an exercise',
    progress: 1,
    target: 1,
    xpReward: 30,
    coinReward: 12,
    kind: 'exercise-pass',
    completed: true,
  },
];

const meta: Meta<DailyQuestList> = {
  title: 'Organisms/DailyQuestList',
  component: DailyQuestList,
  render: (args) => ({
    props: args,
    template: `<cdf-daily-quest-list [quests]="quests" />`,
  }),
};
export default meta;
type Story = StoryObj<DailyQuestList>;

export const Default: Story = { args: { quests: QUESTS } };
export const AllCompleted: Story = {
  args: {
    quests: QUESTS.map((q) => ({ ...q, progress: q.target, completed: true })),
  },
};
