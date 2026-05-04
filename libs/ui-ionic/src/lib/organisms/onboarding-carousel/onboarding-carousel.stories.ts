import type { Meta, StoryObj } from '@storybook/angular';
import { OnboardingCarousel, type OnboardingSlide } from './onboarding-carousel.js';

const SLIDES: OnboardingSlide[] = [
  {
    id: 's1',
    title: 'Learn by doing',
    body: 'Bite-sized lessons, quizzes, and code exercises — designed for daily practice.',
    icon: 'school',
  },
  {
    id: 's2',
    title: 'Build a streak',
    body: 'Finish at least one lesson a day to grow your flame and unlock weekly badges.',
    icon: 'flame',
  },
  {
    id: 's3',
    title: 'Earn rewards',
    body: 'XP, coins, levels, and Mystery Chests reward your progress.',
    icon: 'gift',
  },
];

const meta: Meta<OnboardingCarousel> = {
  title: 'Organisms/OnboardingCarousel',
  component: OnboardingCarousel,
  render: (args) => ({
    props: args,
    template: `
      <div style="height: 600px; max-width: 420px; margin: 0 auto; border:1px solid var(--cdf-color-border); border-radius:16px; overflow:hidden;">
        <cdf-onboarding-carousel [slides]="slides" />
      </div>
    `,
  }),
};
export default meta;
type Story = StoryObj<OnboardingCarousel>;

export const Default: Story = { args: { slides: SLIDES } };
