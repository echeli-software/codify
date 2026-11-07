import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  computed,
  contentChild,
  inject,
  input,
  model,
  output,
} from '@angular/core';
import type {
  LessonDoc,
  LessonRefActivation,
  QuizAnswers,
} from '@codify/lesson-schema';
import { LessonBlocks } from './lesson-blocks.js';
import {
  LessonRefSlot,
  LessonRenderContext,
  type LessonQuizResult,
} from './lesson-render-context.js';

/**
 * Read-only, student-facing renderer for a `LessonDoc`, rendered natively
 * in Angular (no editor engine) so interactive blocks are real components:
 *
 *   <cdf-lesson-block-renderer
 *     [doc]="lesson.contentJson"
 *     [(quizAnswers)]="answers"
 *     [quizResult]="result"
 *     (refActivate)="openRunner($event)"
 *   >
 *     <ng-template cdfLessonRef let-ref>…mount a runner…</ng-template>
 *   </cdf-lesson-block-renderer>
 *
 * - quiz blocks are selectable; every change emits `quizAnswersChange`
 *   (`{ [quizBlockId]: optionIds[] }`) for the page to submit. Passing a
 *   `quizResult` locks the quizzes and shows per-question feedback.
 * - embeds render only allowlisted, sandboxed iframes; images are lazy and
 *   keep their alt text; tables get header scopes and a scroll region.
 * - ref blocks render the projected `cdfLessonRef` template, or a card whose
 *   button emits `refActivate`.
 * - apps can replace any block via the `LESSON_BLOCK_RENDERER` token.
 */
@Component({
  selector: 'cdf-lesson-block-renderer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LessonBlocks],
  providers: [LessonRenderContext],
  template: `
    <div class="cdf-prose cdf-lesson-renderer">
      <cdf-lesson-blocks [blocks]="blocks()" />
    </div>
  `,
  styleUrl: './lesson-block-renderer.scss',
})
export class LessonBlockRenderer {
  readonly doc = input<LessonDoc | null>(null);
  /** Current quiz selections (two-way: `[(quizAnswers)]`). */
  readonly quizAnswers = model<QuizAnswers>({});
  /** Server grading result → per-question feedback; locks the quizzes. */
  readonly quizResult = input<LessonQuizResult | null>(null);
  /** Disable all interactive blocks (e.g. while submitting / offline). */
  readonly interactionDisabled = input(false);

  readonly refActivate = output<LessonRefActivation>();

  private readonly hostEl = inject(ElementRef<HTMLElement>);
  private readonly refSlot = contentChild(LessonRefSlot);

  protected readonly blocks = computed(() => {
    const content = this.doc()?.content;
    return Array.isArray(content) ? content : [];
  });

  constructor() {
    const ctx = inject(LessonRenderContext, { self: true });
    ctx.answers = this.quizAnswers;
    ctx.result = this.quizResult;
    ctx.disabled = this.interactionDisabled;
    ctx.refTemplate = computed(() => this.refSlot()?.template ?? null);
    ctx.setAnswer = (quizId, optionIds) =>
      this.quizAnswers.update((a) => ({ ...a, [quizId]: optionIds }));
    ctx.activateRef = (ref) => this.refActivate.emit(ref);
  }

  /** For tests + outside scoping. */
  get hostElement(): HTMLElement {
    return this.hostEl.nativeElement;
  }
}
