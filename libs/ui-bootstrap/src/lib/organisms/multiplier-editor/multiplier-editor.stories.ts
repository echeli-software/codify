import type { Meta, StoryObj } from '@storybook/angular';
import type { ComboboxOption } from '../../atoms/combobox/combobox.js';
import { MultiplierEditor, type MultiplierDraft } from './multiplier-editor.js';

const COURSES: ComboboxOption<string>[] = [
  { value: 'c-react', label: 'React Fundamentals' },
  { value: 'c-node', label: 'Node.js APIs' },
  { value: 'c-prompt', label: 'Prompt Engineering' },
];
const LESSONS: ComboboxOption<string>[] = [
  { value: 'l-1', label: 'JSX in 5 minutes' },
  { value: 'l-2', label: 'State with hooks' },
];

const meta: Meta<MultiplierEditor> = {
  title: 'Organisms/MultiplierEditor',
  component: MultiplierEditor,
  args: { courseOptions: COURSES, lessonOptions: LESSONS },
};
export default meta;
type Story = StoryObj<MultiplierEditor>;

export const NewCampaign: Story = { args: { value: null } };

export const WeekendCoursePromo: Story = {
  args: {
    value: {
      kind: 'COURSE_PROMO',
      target: 'XP',
      value: 3,
      startsAt: '2026-11-07T00:00',
      endsAt: '2026-11-08T23:59',
      courseId: 'c-react',
      lessonId: null,
      streakDaysMin: null,
      description: 'Black-week React boost',
      isActive: true,
    } satisfies MultiplierDraft,
  },
};

export const StreakTier: Story = {
  args: {
    value: {
      kind: 'STREAK_TIER',
      target: 'BOTH',
      value: 1.2,
      startsAt: null,
      endsAt: null,
      courseId: null,
      lessonId: null,
      streakDaysMin: 7,
      description: null,
      isActive: true,
    } satisfies MultiplierDraft,
  },
};

/** Lesson scope without a lesson + inverted window — submit to see errors. */
export const Invalid: Story = {
  args: {
    value: {
      kind: 'LESSON_PROMO',
      target: 'COINS',
      value: 45,
      startsAt: '2026-12-10T00:00',
      endsAt: '2026-12-01T00:00',
      courseId: 'c-node',
      lessonId: null,
      streakDaysMin: null,
      description: null,
      isActive: false,
    } satisfies MultiplierDraft,
  },
};
