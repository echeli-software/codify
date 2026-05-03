import type { Meta, StoryObj } from '@storybook/angular';
import { LESSON_DOC_VERSION, type LessonDoc } from '@codify/lesson-schema';
import { LessonBlockRenderer } from './lesson-block-renderer.js';

const SAMPLE: LessonDoc = {
  type: 'doc',
  version: LESSON_DOC_VERSION,
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Render-only mode' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'This mounts the same Tiptap engine in ' },
        { type: 'text', marks: [{ type: 'code' }], text: 'editable: false' },
        { type: 'text', text: ' so the prose styling stays identical to the editor.' },
      ],
    },
    {
      type: 'callout',
      attrs: { kind: 'info' },
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Callouts render with their kind-specific border color.' }] },
      ],
    },
  ],
};

const meta: Meta<LessonBlockRenderer> = {
  title: 'Organisms/LessonBlockRenderer',
  component: LessonBlockRenderer,
  args: { doc: SAMPLE },
};
export default meta;
type Story = StoryObj<LessonBlockRenderer>;

export const Sample: Story = {};
