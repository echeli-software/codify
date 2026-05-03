import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { FormsModule } from '@angular/forms';
import {
  LESSON_DOC_VERSION,
  emptyLessonDoc,
  type LessonDoc,
} from '@codify/lesson-schema';
import { LessonBlockEditor } from './lesson-block-editor.js';

const SAMPLE: LessonDoc = {
  type: 'doc',
  version: LESSON_DOC_VERSION,
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Welcome to React' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'React is a JavaScript library for ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'building user interfaces' },
        { type: 'text', text: '.' },
      ],
    },
    {
      type: 'callout',
      attrs: { kind: 'tip' },
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Try editing this callout.' }] },
      ],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'tsx' },
      content: [{ type: 'text', text: 'function Hello() { return <h1>Hi</h1>; }' }],
    },
  ],
};

const meta: Meta<LessonBlockEditor> = {
  title: 'Organisms/LessonBlockEditor',
  component: LessonBlockEditor,
  decorators: [moduleMetadata({ imports: [FormsModule, LessonBlockEditor] })],
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<LessonBlockEditor>;

export const Empty: Story = {
  render: () => ({
    props: { doc: emptyLessonDoc() },
    template: `<div style="padding:24px; max-width:880px;"><cdf-lesson-block-editor [ngModel]="doc" /></div>`,
  }),
};

export const SampleDoc: Story = {
  render: () => ({
    props: { doc: SAMPLE },
    template: `<div style="padding:24px; max-width:880px;"><cdf-lesson-block-editor [ngModel]="doc" /></div>`,
  }),
};
