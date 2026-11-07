import { LESSON_DOC_VERSION, type LessonDoc } from './types.js';

/**
 * A valid doc that contains every block and mark — used by the schema
 * tests, the migration round-trip test, the editor/renderer specs and the
 * Storybook stories. Returns a fresh copy on every call.
 */
export function kitchenSinkLessonDoc(): LessonDoc {
  return {
    type: 'doc',
    version: LESSON_DOC_VERSION,
    attrs: { sourceLocale: 'en' },
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Every block, once' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Plain, ' },
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ', ' },
          { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
          { type: 'text', text: ', ' },
          { type: 'text', text: 'underline', marks: [{ type: 'underline' }] },
          { type: 'text', text: ', ' },
          { type: 'text', text: 'strike', marks: [{ type: 'strike' }] },
          { type: 'text', text: ', ' },
          { type: 'text', text: 'code()', marks: [{ type: 'code' }] },
          { type: 'text', text: ', ' },
          { type: 'text', text: 'highlight', marks: [{ type: 'highlight' }] },
          { type: 'text', text: ', press ' },
          { type: 'text', text: 'Ctrl', marks: [{ type: 'kbd' }] },
          { type: 'text', text: ' + ' },
          { type: 'text', text: 'K', marks: [{ type: 'kbd' }] },
          { type: 'text', text: ' and read ' },
          {
            type: 'text',
            text: 'the docs',
            marks: [
              {
                type: 'link',
                attrs: { href: 'https://angular.dev', target: '_blank' },
              },
            ],
          },
          { type: 'text', text: ' or ' },
          {
            type: 'text',
            text: 'jump down',
            marks: [{ type: 'link', attrs: { href: '#quiz', target: null } }],
          },
          { type: 'text', text: '.' },
          { type: 'hardBreak' },
          { type: 'text', text: 'A second line after a soft break.' },
        ],
      },
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Lists' }],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'First bullet' }],
              },
              {
                type: 'orderedList',
                attrs: { start: 1 },
                content: [
                  {
                    type: 'listItem',
                    content: [
                      {
                        type: 'paragraph',
                        content: [
                          { type: 'text', text: 'Nested numbered item' },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Second bullet' }],
              },
            ],
          },
        ],
      },
      {
        type: 'orderedList',
        attrs: { start: 3 },
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Starts at three' }],
              },
            ],
          },
        ],
      },
      {
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Programs must be written for people to read.',
              },
            ],
          },
        ],
      },
      {
        type: 'callout',
        attrs: { kind: 'tip' },
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Callouts hold nested blocks.' }],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Like this list.' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'codeBlock',
        attrs: {
          language: 'typescript',
          showLineNumbers: true,
          highlightLines: '2',
        },
        content: [
          {
            type: 'text',
            text: 'function greet(name: string) {\n  return `Hi ${name}`;\n}',
          },
        ],
      },
      { type: 'horizontalRule' },
      {
        type: 'image',
        attrs: {
          src: 'https://cdn.codify.app/img/0192f3a4-sample',
          alt: 'Diagram of the component tree',
          caption: 'The component tree for the demo app.',
          assetId: '0192f3a4-sample',
          width: 'wide',
        },
      },
      {
        type: 'embed',
        attrs: {
          provider: 'youtube',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          title: 'Intro video',
        },
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableHeader',
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Hook' }],
                  },
                ],
              },
              {
                type: 'tableHeader',
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Purpose' }],
                  },
                ],
              },
            ],
          },
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      {
                        type: 'text',
                        text: 'signal()',
                        marks: [{ type: 'code' }],
                      },
                    ],
                  },
                ],
              },
              {
                type: 'tableCell',
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Reactive state' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'quiz',
        attrs: {
          id: 'quiz',
          question: 'Which function creates a writable signal?',
          kind: 'single',
          options: [
            { id: 'a', text: 'signal()' },
            { id: 'b', text: 'computed()' },
            { id: 'c', text: 'effect()' },
          ],
          correctOptionIds: ['a'],
          explanation:
            'computed() is read-only and effect() runs side effects.',
        },
      },
      {
        type: 'quiz',
        attrs: {
          id: 'q2',
          question: 'Which are Angular control-flow blocks?',
          kind: 'multiple',
          options: [
            { id: 'a', text: '@if' },
            { id: 'b', text: '@for' },
            { id: 'c', text: '@loop' },
          ],
          correctOptionIds: ['a', 'b'],
          explanation: null,
        },
      },
      {
        type: 'exerciseRef',
        attrs: { exerciseId: '0192f3a4-0000-7000-8000-000000000001' },
      },
      {
        type: 'aiPromptRef',
        attrs: { aiPromptId: '0192f3a4-0000-7000-8000-000000000002' },
      },
      {
        type: 'scenarioRef',
        attrs: { scenarioId: '0192f3a4-0000-7000-8000-000000000003' },
      },
    ],
  };
}
