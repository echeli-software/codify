import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { JsonPipe } from '@angular/common';
import {
  gradeQuiz,
  kitchenSinkLessonDoc,
  stripQuizAnswers,
} from '@codify/lesson-schema';
import { LessonBlockRenderer } from './lesson-block-renderer.js';
import { LessonRefSlot } from './lesson-render-context.js';

const STUDENT_DOC = stripQuizAnswers(kitchenSinkLessonDoc());

const meta: Meta<LessonBlockRenderer> = {
  title: 'Organisms/LessonBlockRenderer',
  component: LessonBlockRenderer,
  decorators: [moduleMetadata({ imports: [JsonPipe, LessonRefSlot] })],
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<LessonBlockRenderer>;

const frame = (inner: string) => `<div style="max-width:760px">${inner}</div>`;

/** Every block, as a student receives it (quiz answers stripped). */
export const EveryBlock: Story = {
  render: () => ({
    props: { doc: STUDENT_DOC, answers: {}, activated: [] as unknown[] },
    template: frame(`
      <cdf-lesson-block-renderer
        [doc]="doc"
        [(quizAnswers)]="answers"
        (refActivate)="activated = activated.concat([$event])"
      />
      <pre style="font-size:12px">answers: {{ answers | json }}\nrefActivate: {{ activated | json }}</pre>
    `),
  }),
};

/** After the server graded the attempt: per-question feedback, inputs locked. */
export const QuizGraded: Story = {
  render: () => {
    const answers = { quiz: ['b'], q2: ['a', 'b'] };
    return {
      props: {
        doc: STUDENT_DOC,
        answers,
        result: gradeQuiz(kitchenSinkLessonDoc(), answers),
      },
      template: frame(
        `<cdf-lesson-block-renderer [doc]="doc" [quizAnswers]="answers" [quizResult]="result" />`,
      ),
    };
  },
};

/** The app mounts its own runners through the `cdfLessonRef` template. */
export const WithRunnerSlot: Story = {
  render: () => ({
    props: { doc: STUDENT_DOC },
    template: frame(`
      <cdf-lesson-block-renderer [doc]="doc">
        <ng-template cdfLessonRef let-ref>
          <div style="padding:16px;border:2px dashed var(--cdf-color-primary);border-radius:8px">
            Runner for <strong>{{ ref.kind }}</strong> <code>{{ ref.id }}</code> mounts here
          </div>
        </ng-template>
      </cdf-lesson-block-renderer>
    `),
  }),
};

export const Disabled: Story = {
  render: () => ({
    props: { doc: STUDENT_DOC },
    template: frame(
      `<cdf-lesson-block-renderer [doc]="doc" [interactionDisabled]="true" />`,
    ),
  }),
};

/** Code blocks: lazy syntax highlighting, line numbers, emphasised lines, copy. */
export const CodeBlocks: Story = {
  render: () => ({
    props: {
      doc: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'codeBlock',
            attrs: {
              language: 'python',
              showLineNumbers: true,
              highlightLines: '2-3',
              copyable: true,
            },
            content: [
              {
                type: 'text',
                text: 'def greet(name: str) -> str:\n    message = f"Hello, {name}!"\n    return message\n\nprint(greet("Ada"))',
              },
            ],
          },
          {
            type: 'codeBlock',
            attrs: { language: 'bash', copyable: false },
            content: [{ type: 'text', text: 'pnpm exec nx run student:serve' }],
          },
        ],
      },
    },
    template: frame(`<cdf-lesson-block-renderer [doc]="doc" />`),
  }),
};

/** Matching + ordering quizzes after grading (answers revealed on pass). */
export const MatchAndOrderGraded: Story = {
  render: () => {
    const answers = {
      quiz: ['a'],
      q2: ['a', 'b'],
      q3: ['a:x', 'b:y', 'c:z'],
      q4: ['0:a', '1:b', '2:c'],
    };
    return {
      props: {
        doc: STUDENT_DOC,
        answers,
        result: gradeQuiz(kitchenSinkLessonDoc(), answers),
      },
      template: frame(
        `<cdf-lesson-block-renderer [doc]="doc" [quizAnswers]="answers" [quizResult]="result" />`,
      ),
    };
  },
};
