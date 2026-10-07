import {
  Directive,
  Injectable,
  InjectionToken,
  TemplateRef,
  inject,
  signal,
  type Signal,
  type Type,
} from '@angular/core';
import type {
  BlockRendererProtocol,
  LessonRefActivation,
  QuizAnswers,
  QuizQuestionResult,
} from '@codify/lesson-schema';

/**
 * App-provided block renderer overrides (docs/06 §5). `resolve()` returning
 * a component class replaces the default rendering for that block type; the
 * component receives a `node` input. Return null to keep the default.
 *
 *   providers: [{ provide: LESSON_BLOCK_RENDERER, useValue: { resolve: (t) => t === 'exerciseRef' ? ExerciseRunnerBlock : null } }]
 */
export const LESSON_BLOCK_RENDERER = new InjectionToken<
  BlockRendererProtocol<Type<unknown>>
>('LESSON_BLOCK_RENDERER');

/** Server grading result fed back into the renderer for per-question feedback. */
export interface LessonQuizResult {
  scorePct: number;
  passed: boolean;
  perQuestion: QuizQuestionResult[];
}

/** Context available inside a `cdfLessonRef` template. */
export interface LessonRefSlotContext {
  $implicit: LessonRefActivation;
  /** Emits `refActivate` for this ref. */
  activate: () => void;
}

/**
 * Template the app supplies to mount its runners where ref blocks sit:
 *
 *   <cdf-lesson-block-renderer [doc]="doc">
 *     <ng-template cdfLessonRef let-ref>
 *       @if (ref.kind === 'exercise') { <app-exercise-runner [exerciseId]="ref.id" /> }
 *     </ng-template>
 *   </cdf-lesson-block-renderer>
 */
@Directive({ selector: 'ng-template[cdfLessonRef]' })
export class LessonRefSlot {
  readonly template = inject<TemplateRef<LessonRefSlotContext>>(TemplateRef);

  static ngTemplateContextGuard(
    _dir: LessonRefSlot,
    ctx: unknown,
  ): ctx is LessonRefSlotContext {
    return true;
  }
}

/** Shared state between the renderer and its nested block components. */
@Injectable()
export class LessonRenderContext {
  answers: Signal<QuizAnswers> = signal({});
  result: Signal<LessonQuizResult | null> = signal(null);
  disabled: Signal<boolean> = signal(false);
  refTemplate: Signal<TemplateRef<LessonRefSlotContext> | null> = signal(null);
  readonly protocol = inject(LESSON_BLOCK_RENDERER, { optional: true });

  setAnswer: (quizId: string, optionIds: string[]) => void = () => undefined;
  activateRef: (ref: LessonRefActivation) => void = () => undefined;
}
