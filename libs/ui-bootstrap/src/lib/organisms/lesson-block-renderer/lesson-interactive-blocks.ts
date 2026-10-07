import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import {
  EMBED_PROVIDER_LABELS,
  embedSrcFor,
  type EmbedNode,
  type LessonRefActivation,
  type QuizAttrs,
} from '@codify/lesson-schema';
import { LessonRenderContext } from './lesson-render-context.js';

let nextId = 0;

/**
 * Student-facing quiz block. Selections flow up through the render context
 * (`quizAnswersChange` on the renderer); a `quizResult` from the server
 * locks the inputs and shows per-question feedback + the explanation.
 */
@Component({
  selector: 'cdf-lesson-quiz',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let q = quiz();
    @let r = result();
    <fieldset
      class="cdf-quiz"
      [class.cdf-quiz--correct]="r?.correct === true"
      [class.cdf-quiz--incorrect]="r?.correct === false"
      [id]="'quiz-' + q.id"
      [attr.aria-describedby]="
        uid + '-hint' + (r ? ' ' + uid + '-feedback' : '')
      "
    >
      <legend class="cdf-quiz__question">{{ q.question }}</legend>
      <p class="cdf-quiz__hint" [id]="uid + '-hint'">
        {{
          q.kind === 'single' ? 'Choose one answer.' : 'Choose all that apply.'
        }}
      </p>
      <ul class="cdf-quiz__options">
        @for (opt of q.options; track opt.id) {
          <li
            class="cdf-quiz__option"
            [class.cdf-quiz__option--selected]="isSelected(opt.id)"
            [class.cdf-quiz__option--answer]="isAnswer(opt.id)"
            [class.cdf-quiz__option--wrong]="
              !!r && isSelected(opt.id) && !isAnswer(opt.id)
            "
          >
            <label>
              <input
                [type]="q.kind === 'single' ? 'radio' : 'checkbox'"
                [name]="uid"
                [value]="opt.id"
                [checked]="isSelected(opt.id)"
                [disabled]="locked()"
                (change)="toggle(opt.id, $any($event.target).checked)"
              />
              <span class="cdf-quiz__text">{{ opt.text }}</span>
              @if (isAnswer(opt.id)) {
                <span class="cdf-quiz__tag">Correct answer</span>
              } @else if (!!r && isSelected(opt.id)) {
                <span class="cdf-quiz__tag cdf-quiz__tag--wrong"
                  >Your answer</span
                >
              }
            </label>
          </li>
        }
      </ul>
      @if (r) {
        <div class="cdf-quiz__feedback" role="status" [id]="uid + '-feedback'">
          <strong>{{ r.correct ? 'Correct!' : 'Not quite.' }}</strong>
          @if (r.explanation) {
            <p>{{ r.explanation }}</p>
          }
        </div>
      }
    </fieldset>
  `,
  styleUrl: './lesson-blocks.scss',
})
export class LessonQuiz {
  readonly quiz = input.required<QuizAttrs>();

  private readonly ctx = inject(LessonRenderContext);
  protected readonly uid = `cdf-quiz-${nextId++}`;

  protected readonly selected = computed(
    () => this.ctx.answers()[this.quiz().id] ?? [],
  );
  protected readonly result = computed(
    () =>
      this.ctx.result()?.perQuestion.find((p) => p.id === this.quiz().id) ??
      null,
  );
  protected readonly locked = computed(
    () => this.ctx.disabled() || this.ctx.result() !== null,
  );

  protected isSelected(id: string): boolean {
    return this.selected().includes(id);
  }

  protected isAnswer(id: string): boolean {
    return this.result()?.correctOptionIds.includes(id) ?? false;
  }

  protected toggle(id: string, checked: boolean): void {
    if (this.locked()) return;
    const q = this.quiz();
    let next: string[];
    if (q.kind === 'single') next = checked ? [id] : [];
    else {
      const current = this.selected().filter((s) => s !== id);
      next = checked ? [...current, id] : current;
    }
    this.ctx.setAnswer(q.id, next);
  }
}

/**
 * Allowlisted embed. The iframe src is rebuilt by `embedSrcFor` from the
 * provider + parsed ids (never the stored URL), sandboxed, lazy-loaded.
 */
@Component({
  selector: 'cdf-lesson-embed',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let n = node();
    <figure class="cdf-embed" [attr.data-provider]="n.attrs.provider">
      @if (safeSrc(); as src) {
        <div class="cdf-embed__frame">
          <iframe
            [src]="src"
            [title]="n.attrs.title"
            loading="lazy"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
            allow="fullscreen; picture-in-picture; encrypted-media; clipboard-write"
            referrerpolicy="strict-origin-when-cross-origin"
            allowfullscreen
          ></iframe>
        </div>
        <figcaption class="cdf-embed__caption">
          {{ n.attrs.title }} · {{ providerLabel() }}
        </figcaption>
      } @else {
        <p class="cdf-embed__unavailable" role="note">
          This embedded content is unavailable.
        </p>
      }
    </figure>
  `,
  styleUrl: './lesson-blocks.scss',
})
export class LessonEmbed {
  readonly node = input.required<EmbedNode>();
  private readonly sanitizer = inject(DomSanitizer);

  /** Canonical src (exposed for tests). */
  readonly src = computed(() =>
    embedSrcFor(this.node().attrs.provider, this.node().attrs.url),
  );
  protected readonly safeSrc = computed(() => {
    const src = this.src();
    // Safe: `src` is built from an allowlisted https host + validated ids.
    return src ? this.sanitizer.bypassSecurityTrustResourceUrl(src) : null;
  });
  protected readonly providerLabel = computed(
    () =>
      EMBED_PROVIDER_LABELS[this.node().attrs.provider] ??
      this.node().attrs.provider,
  );
}

const REF_COPY: Record<
  LessonRefActivation['kind'],
  { label: string; cta: string; text: string }
> = {
  exercise: {
    label: 'Code exercise',
    cta: 'Start exercise',
    text: 'Write code and run the tests.',
  },
  aiPrompt: {
    label: 'AI prompt',
    cta: 'Start prompt task',
    text: 'Answer the prompt; it is graded with a rubric.',
  },
  scenario: {
    label: 'Scenario',
    cta: 'Start scenario',
    text: 'Make choices in a branching scenario.',
  },
};

/**
 * Ref block: renders the app's `cdfLessonRef` template (to mount a runner)
 * or a labeled card whose button emits `refActivate`.
 */
@Component({
  selector: 'cdf-lesson-ref',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  template: `
    @if (ctx.refTemplate(); as tpl) {
      <ng-container
        *ngTemplateOutlet="
          tpl;
          context: { $implicit: ref(), activate: activate }
        "
      />
    } @else {
      <section
        class="cdf-ref-card"
        [attr.data-kind]="ref().kind"
        [attr.aria-labelledby]="uid"
      >
        <div class="cdf-ref-card__body">
          <h3 class="cdf-ref-card__title" [id]="uid">{{ copy().label }}</h3>
          <p class="cdf-ref-card__text">{{ copy().text }}</p>
        </div>
        <button
          type="button"
          class="cdf-ref-card__cta"
          [disabled]="ctx.disabled()"
          (click)="activate()"
        >
          {{ copy().cta }}
        </button>
      </section>
    }
  `,
  styleUrl: './lesson-blocks.scss',
})
export class LessonRef {
  readonly ref = input.required<LessonRefActivation>();
  protected readonly ctx = inject(LessonRenderContext);
  protected readonly uid = `cdf-ref-${nextId++}`;
  protected readonly copy = computed(() => REF_COPY[this.ref().kind]);
  protected readonly activate = (): void => this.ctx.activateRef(this.ref());
}
