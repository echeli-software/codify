import type { Meta, StoryObj } from '@storybook/angular';
import {
  CoursePreviewModal,
  type CoursePreview,
} from './course-preview-modal.js';

const COURSE: CoursePreview = {
  id: 'react',
  title: 'React Fundamentals',
  description:
    'Components, props, state and hooks — build three small apps along the way.',
  author: 'Maria S.',
  lessonCount: 12,
  estimatedMinutes: 185,
  difficulty: 'Beginner',
  categories: [{ id: 'web', label: 'Web' }],
  hasFreePreview: true,
  curriculum: [
    {
      id: 'l1',
      title: 'What is React?',
      type: 'reading',
      status: 'completed',
      estimateMinutes: 5,
      isFree: true,
    },
    {
      id: 'l2',
      title: 'JSX basics',
      type: 'quiz',
      status: 'in-progress',
      estimateMinutes: 8,
      isFree: true,
    },
    {
      id: 'l3',
      title: 'Your first component',
      type: 'exercise',
      status: 'not-started',
      estimateMinutes: 15,
    },
    {
      id: 'l4',
      title: 'Props in practice',
      type: 'reading',
      status: 'locked',
      estimateMinutes: 10,
    },
    {
      id: 'l5',
      title: 'State with hooks',
      type: 'ai-prompt',
      status: 'locked',
      estimateMinutes: 12,
    },
    {
      id: 'l6',
      title: 'Capstone: todo app',
      type: 'capstone',
      status: 'locked',
      estimateMinutes: 45,
    },
    {
      id: 'l7',
      title: 'Wrap-up',
      type: 'scenario',
      status: 'locked',
      estimateMinutes: 6,
    },
  ],
};

const meta: Meta<CoursePreviewModal> = {
  title: 'Organisms/CoursePreviewModal',
  component: CoursePreviewModal,
  parameters: { layout: 'fullscreen' },
  args: { open: true, course: COURSE, maxLessons: 5 },
};
export default meta;
type Story = StoryObj<CoursePreviewModal>;

export const FreePreview: Story = {};
export const PremiumLocked: Story = {
  args: {
    course: {
      ...COURSE,
      id: 'pro',
      title: 'Advanced Node',
      premiumOnly: true,
      hasFreePreview: false,
    },
  },
};
export const ShortCurriculum: Story = {
  args: {
    course: {
      ...COURSE,
      curriculum: COURSE.curriculum.slice(0, 2),
      lessonCount: 2,
      estimatedMinutes: 13,
    },
  },
};
