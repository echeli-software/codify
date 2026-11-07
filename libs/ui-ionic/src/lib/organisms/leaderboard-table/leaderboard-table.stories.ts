import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { AppAvatar } from '../../atoms/app-avatar/app-avatar.js';
import {
  LeaderboardAvatar,
  LeaderboardTable,
  type LeaderboardRow,
} from './leaderboard-table.js';

const NAMES = [
  'Ana',
  'Bruno',
  'Carla',
  'Diego',
  'Elisa',
  'Fábio',
  'Gabi',
  'Hugo',
  'Iara',
  'João',
];

function cohort(size: number, meRank: number): LeaderboardRow[] {
  return Array.from({ length: size }, (_, i) => ({
    userId: `u${i + 1}`,
    displayName:
      i + 1 === meRank
        ? 'You (Maria)'
        : `${NAMES[i % NAMES.length]} ${Math.floor(i / NAMES.length) + 1}`,
    weeklyXp: Math.max(0, 2400 - i * 70),
    level: Math.max(1, 18 - Math.floor(i / 3)),
    rank: i + 1,
    isMe: i + 1 === meRank,
  }));
}

const meta: Meta<LeaderboardTable> = {
  title: 'Organisms/LeaderboardTable',
  component: LeaderboardTable,
  decorators: [moduleMetadata({ imports: [LeaderboardAvatar, AppAvatar] })],
};
export default meta;
type Story = StoryObj<LeaderboardTable>;

export const WeeklyCohort: Story = {
  args: {
    rows: cohort(30, 4),
    promoteCount: 5,
    demoteCount: 5,
    visibleRows: 8,
  },
};

/** Me outside the visible window → pinned footer row. */
export const MePinned: Story = {
  args: {
    rows: cohort(30, 22),
    promoteCount: 5,
    demoteCount: 5,
    visibleRows: 6,
  },
};

/** 1 000 rows — only ~a screenful is in the DOM (CDK virtual scroll). */
export const Virtualized1000: Story = {
  args: {
    rows: cohort(1000, 512),
    promoteCount: 10,
    demoteCount: 10,
    visibleRows: 10,
  },
};

export const WithAvatars: Story = {
  render: () => ({
    props: { rows: cohort(12, 2) },
    template: `
      <cdf-leaderboard-table [rows]="rows" [promoteCount]="3" [demoteCount]="3">
        <ng-template cdfLeaderboardAvatar let-row>
          <cdf-app-avatar [name]="row.displayName" size="sm" />
        </ng-template>
      </cdf-leaderboard-table>`,
  }),
};
