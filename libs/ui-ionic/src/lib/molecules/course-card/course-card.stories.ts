import type { Meta, StoryObj } from '@storybook/angular';
import { CourseCard, type CourseCategoryRef } from './course-card.js';

const FRONTEND: CourseCategoryRef[] = [{ id: 'frontend', label: 'Frontend' }];
const AI: CourseCategoryRef[] = [{ id: 'ai', label: 'AI usage' }];

const meta: Meta<CourseCard> = {
  title: 'Molecules/CourseCard',
  component: CourseCard,
  argTypes: {
    title: { control: 'text' },
    author: { control: 'text' },
    lessonCount: { control: 'number' },
    estimatedMinutes: { control: 'number' },
    difficulty: { control: 'text' },
    hasFreePreview: { control: 'boolean' },
    premiumOnly: { control: 'boolean' },
  },
  render: (args) => ({
    props: args,
    template: `
      <cdf-course-card
        [title]="title"
        [author]="author"
        [lessonCount]="lessonCount"
        [estimatedMinutes]="estimatedMinutes"
        [difficulty]="difficulty"
        [categories]="categories"
        [hasFreePreview]="hasFreePreview"
        [premiumOnly]="premiumOnly"
      />
    `,
  }),
};
export default meta;
type Story = StoryObj<CourseCard>;

export const Default: Story = {
  args: {
    title: 'React Fundamentals',
    author: 'Maria S.',
    lessonCount: 12,
    estimatedMinutes: 180,
    difficulty: 'Iniciante',
    categories: FRONTEND,
    hasFreePreview: true,
  },
};

export const Premium: Story = {
  args: {
    title: 'Advanced AI prompting',
    author: 'Ana T.',
    lessonCount: 8,
    estimatedMinutes: 95,
    difficulty: 'Avançado',
    categories: AI,
    hasFreePreview: false,
    premiumOnly: true,
  },
};
