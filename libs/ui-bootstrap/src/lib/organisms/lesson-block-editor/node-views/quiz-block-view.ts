import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  quizAttrsSchema,
  type QuizAttrs,
  type QuizKind,
} from '@codify/lesson-schema';
import { EditorIcon } from '../../block-toolbar/editor-icon.js';
import { shortId } from '../tiptap/lesson-nodes.js';
import type { LessonNodeViewComponent } from '../tiptap/angular-node-view.js';

let nextId = 0;

/**
 * Editor node view for a quiz block: question, kind, options (mark
 * correct / add / remove) and explanation, with live schema validation.
 */
@Component({
  selector: 'cdf-quiz-block-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EditorIcon],
  templateUrl: './quiz-block-view.html',
  styleUrl: './node-views.scss',
})
export class QuizBlockView implements LessonNodeViewComponent {
  readonly attrs = input<Record<string, unknown>>({});
  readonly editable = input(true);
  readonly attrsChange = output<Record<string, unknown>>();
  readonly remove = output<void>();

  protected readonly uid = `cdf-quiz-view-${nextId++}`;
  protected readonly maxOptions = 10;

  protected readonly quiz = computed<QuizAttrs>(() => {
    const a = this.attrs();
    return {
      id: String(a['id'] ?? ''),
      question: String(a['question'] ?? ''),
      kind: a['kind'] === 'multiple' ? 'multiple' : 'single',
      options: Array.isArray(a['options'])
        ? (a['options'] as QuizAttrs['options'])
        : [],
      correctOptionIds: Array.isArray(a['correctOptionIds'])
        ? (a['correctOptionIds'] as string[])
        : [],
      explanation: (a['explanation'] as string | null | undefined) ?? null,
    };
  });

  protected readonly issues = computed(() => {
    const parsed = quizAttrsSchema.safeParse(this.quiz());
    if (parsed.success) return [];
    return [...new Set(parsed.error.issues.map((i) => i.message))];
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
    // Switching to single keeps at most the first correct option.
    const correct =
      kind === 'single'
        ? (q.correctOptionIds ?? []).slice(0, 1)
        : q.correctOptionIds;
    this.attrsChange.emit({ kind, correctOptionIds: correct });
  }

  protected setOptionText(id: string, event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.attrsChange.emit({
      options: this.quiz().options.map((o) =>
        o.id === id ? { ...o, text } : o,
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
    if (q.options.length >= this.maxOptions) return;
    this.attrsChange.emit({
      options: [...q.options, { id: shortId('o'), text: '' }],
    });
  }

  protected removeOption(id: string): void {
    const q = this.quiz();
    if (q.options.length <= 2) return;
    this.attrsChange.emit({
      options: q.options.filter((o) => o.id !== id),
      correctOptionIds: (q.correctOptionIds ?? []).filter((c) => c !== id),
    });
  }
}
