import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  afterNextRender,
  effect,
  forwardRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { type ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { TranslatePipe } from '@codify/i18n';
import { ThemeService } from '@codify/ui-bootstrap';

export type CodeEditorLanguage =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'json';

type MonacoModule = typeof import('./monaco-setup');
type StandaloneEditor = ReturnType<MonacoModule['monaco']['editor']['create']>;

let monacoPromise: Promise<MonacoModule> | null = null;

/**
 * Monaco's stylesheet, copied to `monaco/` as a build asset (see
 * project.json). Angular doesn't inject CSS imported from lazy JS chunks,
 * so it is linked on demand, next to the dynamic import.
 */
export const MONACO_CSS_HREF = 'monaco/editor.main.css';

function loadMonacoCss(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (document.querySelector(`link[data-monaco-css]`)) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = MONACO_CSS_HREF;
    link.dataset['monacoCss'] = '';
    // A missing stylesheet shouldn't block the editor; it degrades visually.
    link.onload = link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

/** Lazy-load Monaco once per page (dynamic import → separate chunk). */
export function loadMonaco(): Promise<MonacoModule> {
  monacoPromise ??= Promise.all([import('./monaco-setup'), loadMonacoCss()])
    .then(([m]) => m)
    .catch((err: unknown) => {
      monacoPromise = null;
      throw err;
    });
  return monacoPromise;
}

let seq = 0;

/**
 * Code editor for exercise starter/solution/harness code and test JSON.
 * Monaco is loaded on first render through a dynamic import, so it never
 * weighs on the admin's initial bundle; until it arrives (or if it fails to
 * load) a plain monospace textarea holds the value, so the field is always
 * usable. Works with `ngModel` / reactive forms (value = source string).
 *
 *   <cdf-code-editor language="python" [(ngModel)]="solution" [ariaLabel]="..." />
 */
@Component({
  selector: 'cdf-code-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CodeEditor),
      multi: true,
    },
  ],
  template: `
    <div
      class="code-editor"
      [class.code-editor--invalid]="invalid()"
      [style.height.px]="height()"
      [attr.data-language]="language()"
      [attr.data-ready]="ready() || null"
    >
      @if (!ready()) {
        <textarea
          class="code-editor__fallback"
          spellcheck="false"
          [id]="inputId() ?? fallbackId"
          [value]="value()"
          [readOnly]="readonly() || disabled()"
          [attr.aria-label]="ariaLabel()"
          [attr.aria-describedby]="describedBy()"
          [attr.aria-invalid]="invalid() || null"
          (input)="onFallbackInput($event)"
          (blur)="onTouched()"
        ></textarea>
      }
      <div #host class="code-editor__host" [hidden]="!ready()"></div>
    </div>
    @if (loadFailed()) {
      <p class="code-editor__note" role="status">
        {{ 'admin.codeEditor.fallback' | translate }}
      </p>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .code-editor {
        position: relative;
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
        overflow: hidden;
        background: var(--cdf-color-surface);
      }
      .code-editor:focus-within {
        box-shadow: var(--cdf-shadow-focus-ring);
      }
      .code-editor--invalid {
        border-color: var(--cdf-color-danger);
      }
      .code-editor__host {
        width: 100%;
        height: 100%;
      }
      .code-editor__fallback {
        width: 100%;
        height: 100%;
        border: 0;
        padding: 8px;
        resize: none;
        font-family: var(--cdf-font-family-mono, ui-monospace, monospace);
        font-size: 13px;
        line-height: 1.5;
        background: transparent;
        color: var(--cdf-color-text);
      }
      .code-editor__fallback:focus {
        outline: none;
      }
      .code-editor__note {
        margin: 4px 0 0;
        font-size: 12px;
        color: var(--cdf-color-text-muted);
      }
    `,
  ],
})
export class CodeEditor implements ControlValueAccessor {
  readonly language = input<CodeEditorLanguage>('javascript');
  readonly height = input(240);
  readonly readonly = input(false);
  readonly invalid = input(false);
  readonly ariaLabel = input<string | null>(null);
  readonly inputId = input<string | null>(null);
  readonly describedBy = input<string | null>(null);

  protected readonly fallbackId = `cdf-code-editor-${++seq}`;
  protected readonly value = signal('');
  protected readonly disabled = signal(false);
  protected readonly ready = signal(false);
  protected readonly loadFailed = signal(false);

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly theme = inject(ThemeService);
  private editor: StandaloneEditor | null = null;
  private monaco: MonacoModule['monaco'] | null = null;
  private applyingExternal = false;
  private onChange: (v: string) => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      loadMonaco()
        .then((m) => {
          if (this.destroyed) return;
          this.mount(m.monaco);
        })
        .catch(() => this.loadFailed.set(true));
    });
    destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.editor?.getModel()?.dispose();
      this.editor?.dispose();
      this.editor = null;
    });

    effect(() => {
      const lang = this.language();
      const ed = this.editor;
      const model = ed?.getModel();
      if (model && this.monaco)
        this.monaco.editor.setModelLanguage(model, lang);
    });
    effect(() => {
      const ro = this.readonly() || this.disabled();
      untracked(() => this.editor?.updateOptions({ readOnly: ro }));
    });
    effect(() => {
      const dark = this.isDark();
      untracked(() => this.monaco?.editor.setTheme(dark ? 'vs-dark' : 'vs'));
    });
  }

  private destroyed = false;

  private isDark(): boolean {
    const mode = this.theme.mode();
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return (
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-color-scheme: dark)').matches
    );
  }

  private mount(monaco: MonacoModule['monaco']): void {
    this.monaco = monaco;
    const ed = monaco.editor.create(this.host().nativeElement, {
      value: this.value(),
      language: this.language(),
      readOnly: this.readonly() || this.disabled(),
      ariaLabel: this.ariaLabel() ?? undefined,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 2,
      fontSize: 13,
      theme: this.isDark() ? 'vs-dark' : 'vs',
    });
    ed.onDidChangeModelContent(() => {
      if (this.applyingExternal) return;
      const v = ed.getValue();
      this.value.set(v);
      this.onChange(v);
    });
    ed.onDidBlurEditorText(() => this.onTouched());
    this.editor = ed;
    this.ready.set(true);
  }

  writeValue(value: string | null | undefined): void {
    const v = value ?? '';
    this.value.set(v);
    if (this.editor && this.editor.getValue() !== v) {
      this.applyingExternal = true;
      this.editor.setValue(v);
      this.applyingExternal = false;
    }
  }
  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  protected onFallbackInput(ev: Event): void {
    const v = (ev.target as HTMLTextAreaElement).value;
    this.value.set(v);
    this.onChange(v);
  }
}
