import type { Meta, StoryObj } from '@storybook/angular';
import { CelebrationOverlay } from './celebration-overlay.js';

const meta: Meta<CelebrationOverlay> = {
  title: 'Organisms/CelebrationOverlay',
  component: CelebrationOverlay,
  parameters: { layout: 'fullscreen' },
  args: { open: true, seed: 7 },
};
export default meta;
type Story = StoryObj<CelebrationOverlay>;

export const StreakMilestone: Story = {
  args: {
    title: '30-day streak!',
    message: 'A whole month of learning. Keep the flame alive.',
    icon: 'flame',
    xp: 300,
    coins: 150,
  },
};
export const LeaguePromotion: Story = {
  args: {
    title: 'Promoted to Gold league',
    icon: 'podium',
    ctaLabel: 'See standings',
    seed: 42,
  },
};
export const FirstLesson: Story = {
  args: {
    title: 'First lesson done!',
    message: 'That was the hardest one.',
    icon: 'rocket',
    xp: 20,
    coins: 10,
  },
};
