import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import {
  QUIZ_KINDS,
  matchToken,
  parseMatchToken,
  quizAttrsSchema,
  type QuizAttrs,
  type QuizKind,
  type QuizOption,
} from '@codify/lesson-schema';
import { EditorIcon } from '../../block-toolbar/editor-icon.js';
import { shortId } from '../tiptap/lesson-nodes.js';
import type { LessonNodeViewComponent } from '../tiptap/angular-node-view.js';

let nextId = 0;

/**
 * Editor node view for a quiz block: question, kind, options and
 * explanation, with live schema validation. Per kind:
 *   - single / multiple: mark the correct option(s);
 *   - match: each row pairs a left item with its answer (plus optional
 *     distractor answers); the key is derived from the rows;
 *   - order: list the items in the CORRECT order (move up / down); students
 *     get them shuffled.
 * With `structureLocked` (translation mode) only texts are editable.
 */
@Component({
  selector: 'cdf-quiz-block-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EditorIcon, TranslatePipe],
  templateUrl: './quiz-block-view.html',
  styleUrl: './node-views.scss',
})
export class QuizBlockView implements LessonNodeViewComponent {
  readonly attrs = input<Record<string, unknown>>({});
  readonly editable = input(true);
  /** Translation mode: no kind / option / key changes. */
  readonly structureLocked = input(false);
  readonly attrsChange = output<Record<string, unknown>>();
  readonly remove = output<void>();

  protected readonly uid = `cdf-quiz-view-${nextId++}`;
  protected readonly maxOptions = 10;
  protected readonly kinds = QUIZ_KINDS;

  protected readonly quiz = computed<QuizAttrs>(() => {
    const a = this.attrs();
    const kind = (QUIZ_KINDS as readonly unknown[]).includes(a['kind'])
      ? (a['kind'] as QuizKind)
      : 'single';
    return {
      id: String(a['id'] ?? ''),
      question: String(a['question'] ?? ''),
      kind,
      options: Array.isArray(a['options'])
        ? (a['options'] as QuizAttrs['options'])
        : [],
      targets: Array.isArray(a['targets'])
        ? (a['targets'] as QuizOption[])
        : null,
      correctOptionIds: Array.isArray(a['correctOptionIds'])
        ? (a['correctOptionIds'] as string[])
        : [],
      explanation: (a['explanation'] as string | null | undefined) ?? null,
    };
  });

  protected readonly canEditStructure = computed(
    () => this.editable() && !this.structureLocked(),
  );

  protected readonly issues = computed(() => {
    const q = this.quiz();
    const parsed = quizAttrsSchema.safeParse({
      ...q,
      targets: q.kind === 'match' ? q.targets : null,
    });
    if (parsed.success) return [];
    return [...new Set(parsed.error.issues.map((i) => i.message))];
  });

  /** match: optionId → its paired target. */
  protected readonly pairs = computed(() => {
    const q = this.quiz();
    const byId = new Map((q.targets ?? []).map((t) => [t.id, t]));
    const out = new Map<string, QuizOption>();
    for (const token of q.correctOptionIds ?? []) {
      const p = parseMatchToken(token);
      const t = p ? byId.get(p[1]) : undefined;
      if (p && t) out.set(p[0], t);
    }
    return out;
  });

  /** match: answers not paired with any item. */
  protected readonly distractors = computed(() => {
    const used = new Set([...this.pairs().values()].map((t) => t.id));
    return (this.quiz().targets ?? []).filter((t) => !used.has(t.id));
  });

  protected isCorrect(optionId: string): boolean {
    return this.quiz().correctOptionIds?.includes(optionId) ?? false;
  }

  protected setQuestion(event: Event): void {
    this.attrsChange.emit({
      question: (event.target as HTMLTextAreaElement).value,
    });
  }

  protected setExplanation(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.attrsChange.emit({ explanation: value.trim() ? value : null });
  }

  protected setKind(kind: QuizKind): void {
    const q = this.quiz();
    if (kind === q.kind || !this.canEditStructure()) return;
    if (kind === 'match') {
      // One answer per item, paired in order.
      const targets = q.options.map(() => ({ id: shortId('t'), text: '' }));
      this.attrsChange.emit({
        kind,
        targets,
        correctOptionIds: q.options.map((o, i) =>
          matchToken(o.id, targets[i].id),
        ),
      });
    } else if (kind === 'order') {
      this.attrsChange.emit({
        kind,
        targets: null,
        correctOptionIds: q.options.map((o) => o.id),
      });
    } else {
      // Choice kinds keep valid previous picks (at most one for single).
      const ids = new Set(q.options.map((o) => o.id));
      const kept =
        q.kind === 'single' || q.kind === 'multiple'
          ? (q.correctOptionIds ?? []).filter((c) => ids.has(c))
          : [];
      this.attrsChange.emit({
        kind,
        targets: null,
        correctOptionIds: kind === 'single' ? kept.slice(0, 1) : kept,
      });
    }
  }

  protected setOptionText(id: string, event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.attrsChange.emit({
      options: this.quiz().options.map((o) =>
        o.id === id ? { ...o, text } : o,
      ),
    });
  }

  protected setTargetText(id: string, event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.attrsChange.emit({
      targets: (this.quiz().targets ?? []).map((t) =>
        t.id === id ? { ...t, text } : t,
      ),
    });
  }

  protected toggleCorrect(id: string): void {
    const q = this.quiz();
    const current = q.correctOptionIds ?? [];
    let next: string[];
    if (q.kind === 'single') next = [id];
    else
      next = current.includes(id)
        ? current.filter((c) => c !== id)
        : [...current, id];
    this.attrsChange.emit({ correctOptionIds: next });
  }

  protected addOption(): void {
    const q = this.quiz();
    if (q.options.length >= this.maxOptions || !this.canEditStructure()) return;
    const option = { id: shortId('o'), text: '' };
    if (q.kind === 'match') {
      const target = { id: shortId('t'), text: '' };
      this.attrsChange.emit({
        options: [...q.options, option],
        targets: [...(q.targets ?? []), target],
        correctOptionIds: [
          ...(q.correctOptionIds ?? []),
          matchToken(option.id, target.id),
        ],
      });
    } else if (q.kind === 'order') {
      this.attrsChange.emit({
        options: [...q.options, option],
        correctOptionIds: [...q.options.map((o) => o.id), option.id],
      });
    } else {
      this.attrsChange.emit({ options: [...q.options, option] });
    }
  }

  protected removeOption(id: string): void {
    const q = this.quiz();
    if (q.options.length <= 2 || !this.canEditStructure()) return;
    const options = q.options.filter((o) => o.id !== id);
    if (q.kind === 'match') {
      const paired = this.pairs().get(id)?.id;
      this.attrsChange.emit({
        options,
        targets: (q.targets ?? []).filter((t) => t.id !== paired),
        correctOptionIds: (q.correctOptionIds ?? []).filter(
          (c) => parseMatchToken(c)?.[0] !== id,
        ),
      });
    } else if (q.kind === 'order') {
      this.attrsChange.emit({
        options,
        correctOptionIds: options.map((o) => o.id),
      });
    } else {
      this.attrsChange.emit({
        options,
        correctOptionIds: (q.correctOptionIds ?? []).filter((c) => c !== id),
      });
    }
  }

  /** order: move an item within the correct sequence. */
  protected moveOption(index: number, delta: -1 | 1): void {
    const q = this.quiz();
    const to = index + delta;
    if (!this.canEditStructure() || to < 0 || to >= q.options.length) return;
    const options = [...q.options];
    [options[index], options[to]] = [options[to], options[index]];
    this.attrsChange.emit({
      options,
      correctOptionIds: options.map((o) => o.id),
    });
  }

  /** match: add / remove an unpaired (distractor) answer. */
  protected addDistractor(): void {
    const q = this.quiz();
    if ((q.targets ?? []).length >= 12 || !this.canEditStructure()) return;
    this.attrsChange.emit({
      targets: [...(q.targets ?? []), { id: shortId('t'), text: '' }],
    });
  }

  protected removeDistractor(id: string): void {
    if (!this.canEditStructure()) return;
    this.attrsChange.emit({
      targets: (this.quiz().targets ?? []).filter((t) => t.id !== id),
    });
  }
}
