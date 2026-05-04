import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { IonList } from '@ionic/angular/standalone';
import { LessonItem } from './lesson-item.js';

const meta: Meta<LessonItem> = {
  title: 'Molecules/LessonItem',
  component: LessonItem,
  decorators: [moduleMetadata({ imports: [IonList] })],
  argTypes: {
    title: { control: 'text' },
    subtitle: { control: 'text' },
    type: { control: 'select', options: ['reading', 'quiz', 'exercise', 'ai-prompt', 'scenario'] },
    status: { control: 'select', options: ['not-started', 'in-progress', 'completed', 'locked'] },
    isFree: { control: 'boolean' },
    estimateMinutes: { control: 'number' },
  },
  render: (args) => ({
    props: args,
    template: `
      <ion-list inset="true">
        <cdf-lesson-item
          [title]="title"
          [subtitle]="subtitle"
          [type]="type"
          [status]="status"
          [isFree]="isFree"
          [estimateMinutes]="estimateMinutes"
        />
      </ion-list>
    `,
  }),
};
export default meta;
type Story = StoryObj<LessonItem>;

export const NotStarted: Story = {
  args: {
    title: 'Hooks intro',
    subtitle: 'React Fundamentals · Lesson 4 of 12',
    type: 'reading',
    status: 'not-started',
    estimateMinutes: 5,
  },
};
export const InProgress: Story = {
  args: { ...NotStarted.args!, status: 'in-progress' },
};
export const Completed: Story = {
  args: { ...NotStarted.args!, status: 'completed' },
};
export const Locked: Story = {
  args: { ...NotStarted.args!, status: 'locked', isFree: false },
};
export const FreePreview: Story = {
  args: { ...NotStarted.args!, isFree: true },
};

export const AllTypes: Story = {
  render: () => ({
    template: `
      <ion-list inset="true">
        <cdf-lesson-item title="Reading" type="reading" status="not-started" [estimateMinutes]="5" />
        <cdf-lesson-item title="Quiz" type="quiz" status="not-started" [estimateMinutes]="3" />
        <cdf-lesson-item title="Exercise" type="exercise" status="not-started" [estimateMinutes]="12" />
        <cdf-lesson-item title="AI prompt" type="ai-prompt" status="not-started" [estimateMinutes]="6" />
        <cdf-lesson-item title="Scenario" type="scenario" status="not-started" [estimateMinutes]="8" />
      </ion-list>
    `,
  }),
};
