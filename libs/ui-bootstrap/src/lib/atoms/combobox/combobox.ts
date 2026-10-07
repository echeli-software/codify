import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  ElementRef,
  computed,
  forwardRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { TranslatePipe } from '@codify/i18n';
import { firstValueFrom, isObservable, type Observable } from 'rxjs';
import { Icon } from '../icon/icon.js';
import { Spinner } from '../spinner/spinner.js';

export interface ComboboxOption<T = string> {
  value: T;
  label: string;
  /** Secondary line (e.g. course slug, email). */
  description?: string;
  disabled?: boolean;
}

/** Async option source: called (debounced) with the current query. */
export type ComboboxSource<T = string> = (
  query: string,
) =>
  | Promise<ComboboxOption<T>[]>
  | Observable<ComboboxOption<T>[]>
  | ComboboxOption<T>[];

let comboSeq = 0;

/**
 * Typeahead combobox following the WAI-ARIA 1.2 "combobox with listbox
 * popup" pattern: the input owns `role="combobox"`, `aria-expanded`,
 * `aria-controls` and `aria-activedescendant`; options live in a
 * `role="listbox"` and are navigated with ↑/↓/Home/End, picked with Enter,
 * dismissed with Esc. Works with a static `options` list (filtered locally)
 * or an async `source(query)` (debounced, latest-request-wins).
 *
 *   <cdf-combobox [source]="searchCourses" [(ngModel)]="courseId"
 *                 [ariaLabel]="'admin.course' | translate" />
 */
@Component({
  selector: 'cdf-combobox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Spinner, TranslatePipe],
  host: {
    '(document:pointerdown)': 'onDocumentPointer($event)',
  },
  template: `
    <div class="cdf-combobox" [class.cdf-combobox--open]="open()">
      <cdf-icon class="cdf-combobox__leading" name="search" size="sm" />
      <input
        #field
        type="text"
        class="cdf-combobox__input"
        role="combobox"
        autocomplete="off"
        aria-autocomplete="list"
        [id]="inputId() ?? id + '-input'"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-describedby]="describedBy()"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="listId"
        [attr.aria-activedescendant]="activeId()"
        [attr.aria-invalid]="invalid() || null"
        [placeholder]="placeholder() ?? ''"
        [disabled]="disabled()"
        [value]="query()"
        (input)="onInput($any($event.target).value)"
        (focus)="onFocus()"
        (blur)="onTouched()"
        (keydown)="onKeydown($event)"
      />
      @if (loading()) {
        <cdf-spinner
          class="cdf-combobox__trailing"
          size="sm"
          [label]="'common.loading' | translate"
        />
      } @else if (query() && !disabled()) {
        <button
          type="button"
          class="cdf-combobox__clear"
          tabindex="-1"
          [attr.aria-label]="'ui.search.clear' | translate"
          (click)="clear(field)"
        >
          <cdf-icon name="x" size="xs" />
        </button>
      }
      <ul
        class="cdf-combobox__list"
        role="listbox"
        [id]="listId"
        [attr.aria-label]="ariaLabel()"
        [hidden]="!open()"
      >
        @for (opt of results(); track $index; let i = $index) {
          <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -- keyboard lives on the combobox input (aria-activedescendant) -->
          <li
            role="option"
            class="cdf-combobox__option"
            [id]="optionId(i)"
            [class.cdf-combobox__option--active]="i === activeIndex()"
            [attr.aria-selected]="isSelected(opt)"
            [attr.aria-disabled]="opt.disabled || null"
            (pointerdown)="$event.preventDefault()"
            (click)="pick(opt)"
            (pointermove)="activeIndex.set(i)"
          >
            <span class="cdf-combobox__label">{{ opt.label }}</span>
            @if (opt.description) {
              <span class="cdf-combobox__description">{{
                opt.description
              }}</span>
            }
          </li>
        }
      </ul>
      @if (open() && !loading() && results().length === 0) {
        <div class="cdf-combobox__empty" role="status">
          {{ emptyLabel() ?? ('ui.combobox.noResults' | translate) }}
        </div>
      }
    </div>
  `,
  styleUrl: './combobox.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => Combobox),
      multi: true,
    },
  ],
})
export class Combobox<T = string> implements ControlValueAccessor {
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Static options (filtered locally by label). */
  readonly options = input<ComboboxOption<T>[]>([]);
  /** Async source — takes precedence over `options` when set. */
  readonly source = input<ComboboxSource<T> | null>(null);
  readonly debounceMs = input(200);
  /** Minimum characters before the async source is queried. */
  readonly minChars = input(0);
  readonly placeholder = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly describedBy = input<string | null>(null);
  readonly inputId = input<string | null>(null);
  readonly invalid = input(false);
  readonly emptyLabel = input<string | null>(null);

  /** Fires with the picked option (value also flows through ngModel). */
  readonly selectedChange = output<ComboboxOption<T> | null>();

  protected readonly id = `cdf-combobox-${++comboSeq}`;
  protected readonly listId = `${this.id}-listbox`;
  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  protected readonly activeIndex = signal(-1);
  protected readonly disabled = signal(false);
  private readonly remote = signal<ComboboxOption<T>[]>([]);
  private readonly value = signal<T | null>(null);
  private selectedOption: ComboboxOption<T> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private requestSeq = 0;

  protected readonly results = computed<ComboboxOption<T>[]>(() => {
    if (this.source()) return this.remote();
    const q = this.query().trim().toLocaleLowerCase();
    const all = this.options();
    if (!q || q === this.selectedOption?.label.toLocaleLowerCase()) return all;
    return all.filter((o) => o.label.toLocaleLowerCase().includes(q));
  });

  protected readonly activeId = computed(() => {
    const i = this.activeIndex();
    return this.open() && i >= 0 && i < this.results().length
      ? this.optionId(i)
      : null;
  });

  private onChange: (v: T | null) => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
    });
  }

  writeValue(value: T | null | undefined): void {
    this.value.set(value ?? null);
    const match = this.options().find((o) => o.value === value) ?? null;
    this.selectedOption = match;
    this.query.set(match?.label ?? '');
  }
  registerOnChange(fn: (v: T | null) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  /** Show a label for a value set programmatically with an async source. */
  setSelectedOption(option: ComboboxOption<T> | null): void {
    this.selectedOption = option;
    this.value.set(option?.value ?? null);
    this.query.set(option?.label ?? '');
  }

  protected optionId(i: number): string {
    return `${this.id}-opt-${i}`;
  }

  protected isSelected(opt: ComboboxOption<T>): boolean {
    return this.value() !== null && opt.value === this.value();
  }

  protected onFocus(): void {
    if (!this.source()) this.openList();
  }

  protected onInput(text: string): void {
    this.query.set(text);
    this.activeIndex.set(-1);
    if (this.source()) this.fetch(text);
    else this.openList();
  }

  protected onKeydown(ev: KeyboardEvent): void {
    const count = this.results().length;
    switch (ev.key) {
      case 'ArrowDown':
        ev.preventDefault();
        if (!this.open()) this.openList();
        this.move(1, count);
        break;
      case 'ArrowUp':
        ev.preventDefault();
        if (!this.open()) this.openList();
        this.move(-1, count);
        break;
      case 'Home':
        if (this.open() && count) {
          ev.preventDefault();
          this.activeIndex.set(0);
          this.scrollActive();
        }
        break;
      case 'End':
        if (this.open() && count) {
          ev.preventDefault();
          this.activeIndex.set(count - 1);
          this.scrollActive();
        }
        break;
      case 'Enter': {
        const opt = this.results()[this.activeIndex()];
        if (this.open() && opt) {
          ev.preventDefault();
          this.pick(opt);
        }
        break;
      }
      case 'Escape':
        if (this.open()) {
          ev.preventDefault();
          this.close();
        } else if (this.query()) {
          this.query.set('');
        }
        break;
      case 'Tab':
        this.close();
        break;
    }
  }

  protected pick(opt: ComboboxOption<T>): void {
    if (opt.disabled) return;
    this.selectedOption = opt;
    this.value.set(opt.value);
    this.query.set(opt.label);
    this.onChange(opt.value);
    this.selectedChange.emit(opt);
    this.close();
  }

  protected clear(field: HTMLInputElement): void {
    this.query.set('');
    this.selectedOption = null;
    this.value.set(null);
    this.onChange(null);
    this.selectedChange.emit(null);
    this.remote.set([]);
    field.focus();
  }

  protected onDocumentPointer(ev: Event): void {
    if (!this.open()) return;
    const target = ev.target as Node | null;
    if (target && !(this.host.nativeElement as HTMLElement).contains(target))
      this.close();
  }

  private openList(): void {
    if (this.disabled()) return;
    this.open.set(true);
  }

  private close(): void {
    this.open.set(false);
    this.activeIndex.set(-1);
  }

  private move(delta: number, count: number): void {
    if (!count) return;
    let i = this.activeIndex();
    for (let step = 0; step < count; step++) {
      i = (i + delta + count) % count;
      if (!this.results()[i]?.disabled) break;
    }
    this.activeIndex.set(i);
    this.scrollActive();
  }

  private scrollActive(): void {
    const id = this.activeId();
    if (!id) return;
    queueMicrotask(() => {
      const el = (this.host.nativeElement as HTMLElement).querySelector(
        `#${id}`,
      );
      (el as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' });
    });
  }

  private fetch(text: string): void {
    if (this.timer) clearTimeout(this.timer);
    const source = this.source();
    if (!source) return;
    if (text.trim().length < this.minChars()) {
      this.remote.set([]);
      this.loading.set(false);
      this.close();
      return;
    }
    this.loading.set(true);
    this.openList();
    this.timer = setTimeout(async () => {
      const seq = ++this.requestSeq;
      try {
        const res = source(text);
        const items = isObservable(res) ? await firstValueFrom(res) : await res;
        if (seq !== this.requestSeq) return; // a newer query won
        this.remote.set(items ?? []);
        this.activeIndex.set(items?.length ? 0 : -1);
      } catch {
        if (seq === this.requestSeq) this.remote.set([]);
      } finally {
        if (seq === this.requestSeq) this.loading.set(false);
      }
    }, this.debounceMs());
  }
}
