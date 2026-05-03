import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  effect,
  inject,
  input,
  OnDestroy,
  viewChild,
} from '@angular/core';
import { Editor } from '@tiptap/core';
import { emptyLessonDoc, type LessonDoc } from '@codify/lesson-schema';
import { buildLessonExtensions } from '../lesson-block-editor/tiptap/extensions.js';

/**
 * Read-only renderer for a `LessonDoc`. Uses a Tiptap editor in
 * `editable: false` mode so the same custom node views, parsers, and
 * styling apply to both authoring and student-facing surfaces. Same DOM →
 * same `.ProseMirror` class → same `lesson-prose` global styles apply.
 *
 *   <cdf-lesson-block-renderer [doc]="lesson.contentJson" />
 */
@Component({
  selector: 'cdf-lesson-block-renderer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="cdf-lesson-renderer"></div>`,
  styleUrl: './lesson-block-renderer.scss',
})
export class LessonBlockRenderer implements OnDestroy {
  readonly doc = input<LessonDoc | null>(null);

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly hostEl = inject(ElementRef<HTMLElement>);
  private editor: Editor | null = null;

  constructor() {
    // Initialize once.
    effect(() => {
      const el = this.host().nativeElement;
      if (this.editor) return;
      this.editor = new Editor({
        element: el,
        extensions: buildLessonExtensions({ placeholder: '' }),
        editable: false,
        content: this.doc() ?? emptyLessonDoc(),
      });
    });

    // React to doc changes by replacing content.
    effect(() => {
      const next = this.doc();
      if (!this.editor || !next) return;
      const current = this.editor.getJSON();
      if (JSON.stringify(current) === JSON.stringify(next)) return;
      this.editor.commands.setContent(next as unknown as Record<string, unknown>);
    });
  }

  ngOnDestroy(): void {
    this.editor?.destroy();
    this.editor = null;
  }

  /** For tests + outside scoping. */
  get hostElement(): HTMLElement {
    return this.hostEl.nativeElement;
  }
}
