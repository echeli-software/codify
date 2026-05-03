import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  emptyLessonDoc,
  LESSON_DOC_VERSION,
  lessonDocSchema,
  type LessonDoc,
} from '@codify/lesson-schema';
import {
  BreadcrumbBar,
  type BreadcrumbCrumb,
  Button,
  Divider,
  FormField,
  Icon,
  Input,
  LessonBlockEditor,
  LessonBlockRenderer,
  ToastService,
} from '@codify/ui-bootstrap';

const STARTER_DOC: LessonDoc = {
  type: 'doc',
  version: LESSON_DOC_VERSION,
  attrs: { sourceLocale: 'pt-BR' },
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Welcome to React' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'React is a JavaScript library for ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'building user interfaces' },
        { type: 'text', text: '. In this lesson we’ll cover the core concepts.' },
      ],
    },
    {
      type: 'callout',
      attrs: { kind: 'tip' },
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Try editing this callout — switch its kind from the toolbar.' },
          ],
        },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Components are the building blocks.' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Props pass data down.' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'State drives changes over time.' }],
            },
          ],
        },
      ],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'tsx' },
      content: [{ type: 'text', text: "function Hello() {\n  return <h1>Hello</h1>;\n}" }],
    },
  ],
};

@Component({
  imports: [
    FormsModule,
    BreadcrumbBar,
    Button,
    Divider,
    FormField,
    Icon,
    Input,
    LessonBlockEditor,
    LessonBlockRenderer,
  ],
  templateUrl: './lessons.page.html',
  styleUrl: './lessons.page.scss',
})
export class LessonsPage {
  private readonly toasts = inject(ToastService);

  protected readonly title = signal('Welcome to React');
  protected readonly doc = signal<LessonDoc>(STARTER_DOC);
  protected readonly previewMode = signal<'split' | 'preview' | 'edit'>('split');

  protected readonly crumbs: BreadcrumbCrumb[] = [
    { label: 'Catalog', routerLink: ['/'] },
    { label: 'Courses', routerLink: ['/courses'] },
    { label: 'Lesson editor' },
  ];

  /** Block-count summary for the topbar — proves doc updates are reactive. */
  protected readonly blockCount = computed(() => this.doc().content.length);

  protected setMode(mode: 'split' | 'preview' | 'edit'): void {
    this.previewMode.set(mode);
  }

  protected save(): void {
    try {
      lessonDocSchema.parse(this.doc());
      this.toasts.success(`Saved "${this.title()}" — ${this.blockCount()} blocks.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Invalid document';
      this.toasts.error(`Validation failed: ${msg}`);
    }
  }

  protected loadEmpty(): void {
    this.doc.set(emptyLessonDoc('pt-BR'));
  }

  protected loadSample(): void {
    this.doc.set(STARTER_DOC);
  }
}
