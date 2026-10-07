import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { EditorIcon } from '../../block-toolbar/editor-icon.js';
import type { LessonNodeViewComponent } from '../tiptap/angular-node-view.js';

interface RefKind {
  attr: 'exerciseId' | 'aiPromptId' | 'scenarioId';
  label: string;
  description: string;
  icon: string;
}

const KINDS: RefKind[] = [
  {
    attr: 'exerciseId',
    label: 'Code exercise',
    description: 'Students solve an auto-graded coding exercise here.',
    icon: 'Terminal',
  },
  {
    attr: 'aiPromptId',
    label: 'AI prompt',
    description: 'Students answer a rubric-graded prompt here.',
    icon: 'Robot',
  },
  {
    attr: 'scenarioId',
    label: 'Scenario',
    description: 'Students play a branching scenario here.',
    icon: 'TreeStructure',
  },
];

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
let nextId = 0;

/**
 * Editor node view for exerciseRef / aiPromptRef / scenarioRef: a labeled
 * card with an id input. The kind is inferred from which id attr exists.
 */
@Component({
  selector: 'cdf-ref-block-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EditorIcon],
  template: `
    <section class="cdf-nv cdf-nv--ref" [attr.aria-labelledby]="uid + '-title'">
      <header class="cdf-nv__header">
        <span class="cdf-nv__badge"
          ><cdf-editor-icon [name]="kind().icon" size="16"
        /></span>
        <h4 class="cdf-nv__title" [id]="uid + '-title'">{{ kind().label }}</h4>
        @if (editable()) {
          <button
            type="button"
            class="cdf-nv__icon-btn"
            [attr.aria-label]="'Delete ' + kind().label + ' block'"
            [attr.title]="'Delete ' + kind().label + ' block'"
            (click)="remove.emit()"
          >
            <cdf-editor-icon name="Trash" size="16" />
          </button>
        }
      </header>
      <p class="cdf-nv__hint">{{ kind().description }}</p>
      <label class="cdf-nv__field">
        <span class="cdf-nv__label">{{ kind().label }} id</span>
        <input
          type="text"
          [value]="value()"
          [readOnly]="!editable()"
          [attr.aria-invalid]="!valid() || null"
          [attr.aria-describedby]="!valid() ? uid + '-err' : null"
          placeholder="Paste the id from the admin list"
          (input)="onInput($event)"
        />
      </label>
      @if (!valid()) {
        <p class="cdf-nv__issues" role="status" [id]="uid + '-err'">
          <cdf-editor-icon name="WarningCircle" size="14" />
          Enter a valid id (letters, digits, - and _).
        </p>
      }
    </section>
  `,
  styleUrl: './node-views.scss',
})
export class RefBlockView implements LessonNodeViewComponent {
  readonly attrs = input<Record<string, unknown>>({});
  readonly editable = input(true);
  readonly attrsChange = output<Record<string, unknown>>();
  readonly remove = output<void>();

  protected readonly uid = `cdf-ref-view-${nextId++}`;

  protected readonly kind = computed<RefKind>(() => {
    const a = this.attrs();
    return KINDS.find((k) => k.attr in a) ?? KINDS[0];
  });

  protected readonly value = computed(() =>
    String(this.attrs()[this.kind().attr] ?? ''),
  );
  protected readonly valid = computed(() => ID_PATTERN.test(this.value()));

  protected onInput(event: Event): void {
    this.attrsChange.emit({
      [this.kind().attr]: (event.target as HTMLInputElement).value.trim(),
    });
  }
}
