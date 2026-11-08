import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  InjectionToken,
  type ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';

/** The slice of Monaco's API the editor uses (`editor.api`). */
export type MonacoApi = typeof import('monaco-editor/editor/editor.api.js');
type MonacoModule = { monaco: MonacoApi };
type StandaloneEditor = ReturnType<MonacoApi['editor']['create']>;

/**
 * Loads Monaco (a dynamic `import()` of the app's monaco-setup module, so
 * it stays a lazy chunk of the app). Without it — Storybook, tests — the
 * editor keeps the plain textarea. The student app provides it.
 */
export const MONACO_LOADER = new InjectionToken<() => Promise<MonacoModule>>(
  'MONACO_LOADER',
);

let monacoPromise: Promise<MonacoModule> | null = null;

/**
 * Monaco's stylesheet, copied to `monaco/` as a build asset (apps/student
 * project.json). CSS imported from a lazy JS chunk isn't injected by the
 * Angular builder, so it is linked on demand next to the dynamic import.
 */
export const MONACO_CSS_HREF = 'monaco/editor.main.css';

function loadMonacoCss(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (document.querySelector('link[data-monaco-css]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = MONACO_CSS_HREF;
    link.dataset['monacoCss'] = '';
    link.onload = link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

/** Lazy-load Monaco once per page through the app's loader. */
export function loadMonaco(
  loader: () => Promise<MonacoModule>,
): Promise<MonacoModule> {
  monacoPromise ??= Promise.all([loader(), loadMonacoCss()])
    .then(([m]) => m)
    .catch((err: unknown) => {
      monacoPromise = null;
      throw err;
    });
  return monacoPromise;
}

/**
 * Monaco is a desktop editor: on touch-only devices (no fine pointer) its
 * selection handles, IME composition and on-screen keyboard handling are
 * unreliable and Microsoft lists mobile browsers as unsupported. There we
 * keep the native textarea, which phones handle well (docs/05 Exercise).
 */
export function preferMonaco(
  mq: ((q: string) => boolean) | null = typeof matchMedia === 'function'
    ? (q) => matchMedia(q).matches
    : null,
): boolean {
  // No media queries (SSR / tests): stay on the plain textarea.
  if (!mq) return false;
  return !(mq('(pointer: coarse)') && !mq('(any-pointer: fine)'));
}

/** Monaco language id for an exercise language. */
export function monacoLanguage(language: string): string {
  switch (language) {
    case 'web':
    case 'html':
      return 'html';
    case 'typescript':
      return 'typescript';
    case 'python':
      return 'python';
    default:
      return 'javascript';
  }
}

let seq = 0;

/**
 * Code editor for exercises. Monaco loads on first render via a dynamic
 * import (desktop / devices with a fine pointer); until it arrives — or
 * on touch-only devices, or if it fails — a monospace textarea holds the
 * value, so the editor is always usable. `readonly` disables editing
 * (offline "Connect to run code").
 *
 *   <cdf-code-editor language="python" [(value)]="code" [label]="…" />
 */
@Component({
  selector: 'cdf-code-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <div
      class="cdf-code-editor"
      [style.height.px]="height()"
      [attr.data-language]="language()"
      [attr.data-engine]="ready() ? 'monaco' : 'textarea'"
      [class.cdf-code-editor--readonly]="readonly()"
    >
      @if (!ready()) {
        <textarea
          class="cdf-code-editor__fallback"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          [id]="inputId() ?? fallbackId"
          [value]="value()"
          [readOnly]="readonly()"
          [attr.aria-label]="label()"
          (input)="value.set($any($event.target).value)"
          (keydown)="onKey($event)"
        ></textarea>
      }
      <div #host class="cdf-code-editor__host" [hidden]="!ready()"></div>
    </div>
    @if (ready()) {
      <p class="cdf-code-editor__hint">
        {{ 'ui.codeEditor.escHint' | translate }}
      </p>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .cdf-code-editor {
        position: relative;
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm, 8px);
        overflow: hidden;
        background: var(--cdf-color-surface);
      }
      .cdf-code-editor:focus-within {
        box-shadow: 0 0 0 3px
          color-mix(in srgb, var(--cdf-color-primary) 35%, transparent);
      }
      .cdf-code-editor--readonly {
        opacity: 0.85;
      }
      .cdf-code-editor__host {
        width: 100%;
        height: 100%;
      }
      .cdf-code-editor__fallback {
        width: 100%;
        height: 100%;
        border: 0;
        padding: 10px;
        resize: none;
        font-family: var(--cdf-font-family-mono, ui-monospace, monospace);
        font-size: 14px;
        line-height: 1.5;
        background: transparent;
        color: var(--cdf-color-text);
        tab-size: 2;
      }
      .cdf-code-editor__fallback:focus {
        outline: none;
      }
      .cdf-code-editor__hint {
        margin: 4px 0 0;
        font-size: 12px;
        color: var(--cdf-color-text-muted);
      }
    `,
  ],
})
export class CodeEditor {
  readonly value = model('');
  readonly language = input('javascript');
  readonly height = input(260);
  readonly readonly = input(false);
  readonly label = input<string | null>(null);
  readonly inputId = input<string | null>(null);
  /** Force the textarea (tests / stories); default: Monaco when suitable. */
  readonly plain = input(false);

  protected readonly fallbackId = `cdf-code-editor-${++seq}`;
  protected readonly ready = signal(false);

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly loader = inject(MONACO_LOADER, { optional: true });
  private editor: StandaloneEditor | null = null;
  private monaco: MonacoApi | null = null;
  private applying = false;
  private destroyed = false;

  constructor() {
    afterNextRender(() => {
      const loader = this.loader;
      if (!loader || this.plain() || !preferMonaco()) return;
      loadMonaco(loader)
        .then((m) => {
          if (!this.destroyed) this.mount(m.monaco);
        })
        .catch(() => undefined); // keep the textarea
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.editor?.getModel()?.dispose();
      this.editor?.dispose();
      this.editor = null;
    });
    effect(() => {
      const v = this.value();
      untracked(() => {
        if (this.editor && this.editor.getValue() !== v) {
          this.applying = true;
          this.editor.setValue(v);
          this.applying = false;
        }
      });
    });
    effect(() => {
      const ro = this.readonly();
      untracked(() => this.editor?.updateOptions({ readOnly: ro }));
    });
    effect(() => {
      const lang = monacoLanguage(this.language());
      untracked(() => {
        const model = this.editor?.getModel();
        if (model && this.monaco)
          this.monaco.editor.setModelLanguage(model, lang);
      });
    });
  }

  private isDark(): boolean {
    if (typeof document !== 'undefined') {
      const t = document.documentElement.dataset['theme'];
      if (t === 'dark') return true;
      if (t === 'light') return false;
    }
    return (
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-color-scheme: dark)').matches
    );
  }

  private mount(monaco: MonacoApi): void {
    this.monaco = monaco;
    const ed = monaco.editor.create(this.host().nativeElement, {
      value: this.value(),
      language: monacoLanguage(this.language()),
      readOnly: this.readonly(),
      ariaLabel: this.label() ?? undefined,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 2,
      fontSize: 14,
      // Esc then Tab leaves the editor (no keyboard trap, WCAG 2.1.2).
      tabFocusMode: false,
      theme: this.isDark() ? 'vs-dark' : 'vs',
    });
    ed.onDidChangeModelContent(() => {
      if (!this.applying) this.value.set(ed.getValue());
    });
    this.editor = ed;
    this.ready.set(true);
  }

  /** Tab inserts two spaces; Esc then Tab leaves the textarea. */
  protected onKey(ev: KeyboardEvent): void {
    const el = ev.target as HTMLTextAreaElement;
    if (el.readOnly) return;
    if (ev.key === 'Escape') {
      el.dataset['escaped'] = '1';
      return;
    }
    if (ev.key !== 'Tab' || ev.shiftKey || el.dataset['escaped'] === '1') {
      delete el.dataset['escaped'];
      return;
    }
    ev.preventDefault();
    const { selectionStart: s, selectionEnd: e, value } = el;
    const next = `${value.slice(0, s)}  ${value.slice(e)}`;
    el.value = next;
    el.selectionStart = el.selectionEnd = s + 2;
    this.value.set(next);
  }
}
