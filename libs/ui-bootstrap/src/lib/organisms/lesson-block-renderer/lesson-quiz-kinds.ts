import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { I18nService, TranslatePipe } from '@codify/i18n';
import {
  matchToken,
  orderAnswerTokens,
  orderFromTokens,
  parseMatchToken,
  type QuizAttrs,
  type QuizQuestionResult,
} from '@codify/lesson-schema';
import { LessonRenderContext } from './lesson-render-context.js';

let nextId = 0;

/**
 * Matching quiz: one native `<select>` per left-hand item (keyboard and
 * screen-reader friendly, no drag). The answer reaches the page only once
 * every item is paired, so "answer all" gating works unchanged; partial
 * picks stay local.
 */
@Component({
  selector: 'cdf-lesson-quiz-match',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    @let q = quiz();
    <ul class="cdf-quiz__match">
      @for (opt of q.options; track opt.id; let i = $index) {
        <li
          class="cdf-quiz__pair"
          [class.cdf-quiz__option--answer]="
            !!correctFor(opt.id) && !isWrong(opt.id)
          "
          [class.cdf-quiz__option--wrong]="isWrong(opt.id)"
        >
          <label class="cdf-quiz__pair-label" [for]="uid + '-' + opt.id">{{
            opt.text
          }}</label>
          <select
            class="cdf-quiz__select"
            [id]="uid + '-' + opt.id"
            [disabled]="locked()"
            [value]="picks()[opt.id] || ''"
            (change)="pick(opt.id, $any($event.target).value)"
          >
            <option value="">
              {{ 'ui.lesson.quiz.matchChoose' | translate }}
            </option>
            @for (t of q.targets ?? []; track t.id) {
              <option [value]="t.id" [selected]="picks()[opt.id] === t.id">
                {{ t.text }}
              </option>
            }
          </select>
          @if (correctFor(opt.id); as right) {
            <span class="cdf-quiz__tag">{{
              'ui.lesson.quiz.correctMatch' | translate: { answer: right }
            }}</span>
          }
        </li>
      }
    </ul>
  `,
  styleUrl: './lesson-blocks.scss',
})
export class LessonQuizMatch {
  readonly quiz = input.required<QuizAttrs>();
  readonly result = input<QuizQuestionResult | null>(null);
  readonly locked = input(false);

  private readonly ctx = inject(LessonRenderContext);
  protected readonly uid = `cdf-quiz-match-${nextId++}`;
  /** optionId → targetId (local, may be partial). */
  protected readonly picks = signal<Record<string, string>>({});

  constructor() {
    // Mirror the page's answer (restore / retry resets).
    effect(() => {
      const tokens = this.ctx.answers()[this.quiz().id] ?? [];
      untracked(() => {
        if (tokens.length > 0) {
          const next: Record<string, string> = {};
          for (const t of tokens) {
            const pair = parseMatchToken(t);
            if (pair) next[pair[0]] = pair[1];
          }
          this.picks.set(next);
        } else if (this.complete(this.picks())) {
          this.picks.set({});
        }
      });
    });
  }

  private complete(p: Record<string, string>): boolean {
    return this.quiz().options.every((o) => !!p[o.id]);
  }

  protected pick(optionId: string, targetId: string): void {
    if (this.locked()) return;
    const next = { ...this.picks() };
    if (targetId) {
      // A target can only be used once: free it from any other item.
      for (const k of Object.keys(next))
        if (next[k] === targetId) delete next[k];
      next[optionId] = targetId;
    } else delete next[optionId];
    this.picks.set(next);
    const q = this.quiz();
    this.ctx.setAnswer(
      q.id,
      this.complete(next)
        ? q.options.map((o) => matchToken(o.id, next[o.id]))
        : [],
    );
  }

  /** Text of the right answer for `optionId`, once revealed. */
  protected correctFor(optionId: string): string | null {
    const r = this.result();
    if (!r) return null;
    for (const t of r.correctOptionIds) {
      const pair = parseMatchToken(t);
      if (pair && pair[0] === optionId)
        return this.quiz().targets?.find((x) => x.id === pair[1])?.text ?? null;
    }
    return null;
  }

  protected isWrong(optionId: string): boolean {
    const r = this.result();
    if (!r || r.correct) return false;
    const right = this.correctFor(optionId);
    if (right === null) return false;
    const picked = this.quiz().targets?.find(
      (t) => t.id === this.picks()[optionId],
    )?.text;
    return picked !== right;
  }
}

/**
 * Ordering quiz: an ordered list with "move up" / "move down" buttons per
 * item (keyboard accessible, no drag), focus kept on the moved item and
 * every move announced. The arrangement becomes the answer on the first
 * move or when the student confirms the starting order.
 */
@Component({
  selector: 'cdf-lesson-quiz-order',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <ol class="cdf-quiz__order">
      @for (item of items(); track item.id; let i = $index; let last = $last) {
        <li
          class="cdf-quiz__order-item"
          [class.cdf-quiz__option--answer]="correctIndex(item.id) === i"
          [class.cdf-quiz__option--wrong]="
            !!result() && !result()!.correct && correctIndex(item.id) !== i
          "
        >
          <span class="cdf-quiz__order-pos" aria-hidden="true">{{
            i + 1
          }}</span>
          <span class="cdf-quiz__text" [id]="uid + '-' + item.id">{{
            item.text
          }}</span>
          <span class="cdf-quiz__order-actions">
            <button
              type="button"
              class="cdf-quiz__move"
              [id]="uid + '-' + item.id + '-up'"
              [disabled]="locked() || i === 0"
              [attr.aria-label]="
                'ui.lesson.quiz.moveUp' | translate: { item: item.text }
              "
              (click)="move(i, -1)"
            >
              ↑
            </button>
            <button
              type="button"
              class="cdf-quiz__move"
              [id]="uid + '-' + item.id + '-down'"
              [disabled]="locked() || last"
              [attr.aria-label]="
                'ui.lesson.quiz.moveDown' | translate: { item: item.text }
              "
              (click)="move(i, 1)"
            >
              ↓
            </button>
          </span>
        </li>
      }
    </ol>
    @if (!answered() && !locked()) {
      <button type="button" class="cdf-quiz__confirm" (click)="confirm()">
        {{ 'ui.lesson.quiz.orderConfirm' | translate }}
      </button>
    }
    <p class="cdf-quiz__sr" role="status">{{ announcement() }}</p>
  `,
  styleUrl: './lesson-blocks.scss',
})
export class LessonQuizOrder {
  readonly quiz = input.required<QuizAttrs>();
  readonly result = input<QuizQuestionResult | null>(null);
  readonly locked = input(false);

  private readonly ctx = inject(LessonRenderContext);
  private readonly i18n = inject(I18nService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly uid = `cdf-quiz-order-${nextId++}`;
  /** Option ids in the student's current order (null = delivered order). */
  private readonly order = signal<string[] | null>(null);
  protected readonly announcement = signal('');

  protected readonly items = computed(() => {
    const q = this.quiz();
    const ids = this.order() ?? q.options.map((o) => o.id);
    const byId = new Map(q.options.map((o) => [o.id, o]));
    return ids
      .map((id) => byId.get(id))
      .filter((o): o is NonNullable<typeof o> => !!o);
  });
  protected readonly answered = computed(
    () => (this.ctx.answers()[this.quiz().id]?.length ?? 0) > 0,
  );

  constructor() {
    effect(() => {
      const tokens = this.ctx.answers()[this.quiz().id] ?? [];
      untracked(() => {
        if (tokens.length > 0) this.order.set(orderFromTokens(tokens));
      });
    });
  }

  /** Position of `id` in the revealed correct order, or -1. */
  protected correctIndex(id: string): number {
    const r = this.result();
    if (!r) return -1;
    return orderFromTokens(r.correctOptionIds).indexOf(id);
  }

  protected confirm(): void {
    this.commit(this.items().map((o) => o.id));
  }

  protected move(index: number, delta: -1 | 1): void {
    if (this.locked()) return;
    const ids = this.items().map((o) => o.id);
    const to = index + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    this.order.set(ids);
    this.commit(ids);
    const moved = this.items()[to];
    this.announcement.set(
      this.i18n.t('ui.lesson.quiz.moved', {
        item: moved?.text ?? '',
        position: to + 1,
        total: ids.length,
      }),
    );
    // Keep focus on the moved item (its same-direction button, or the
    // other one when it reached an end).
    afterNextRender(
      () => {
        const el = this.host.nativeElement;
        const id = moved?.id ?? '';
        // Ids are [A-Za-z0-9_-] (schema), safe inside an attribute selector.
        const button = (dir: string) =>
          el.querySelector<HTMLButtonElement>(
            `[id="${this.uid}-${id}-${dir}"]`,
          );
        const same = button(delta < 0 ? 'up' : 'down');
        (same && !same.disabled
          ? same
          : button(delta < 0 ? 'down' : 'up')
        )?.focus();
      },
      { injector: this.injector },
    );
  }

  private commit(ids: string[]): void {
    this.order.set(ids);
    this.ctx.setAnswer(this.quiz().id, orderAnswerTokens(ids));
  }
}
