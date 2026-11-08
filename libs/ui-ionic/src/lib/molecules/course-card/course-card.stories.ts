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
    coverUrl: { control: 'text' },
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
        [coverUrl]="coverUrl"
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

/** With a cover image (docs/05 §3 course cards). */
export const WithCover: Story = {
  args: {
    title: 'React Fundamentals',
    author: 'Maria S.',
    lessonCount: 12,
    estimatedMinutes: 180,
    difficulty: 'Iniciante',
    categories: FRONTEND,
    hasFreePreview: true,
    coverUrl:
      'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="%236366f1"/></svg>',
  },
};
