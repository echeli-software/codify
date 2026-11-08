import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { I18nService, TranslatePipe } from '@codify/i18n';
import type { CodeBlockNode } from '@codify/lesson-schema';
import {
  canonicalCodeLanguage,
  codeLanguageLabel,
  parseHighlightLines,
} from './code-languages.js';

type Highlighter = typeof import('./highlighter.js');

let highlighter: Promise<Highlighter> | null = null;
/** The lazily loaded highlighter chunk (one import per page). */
function loadHighlighter(): Promise<Highlighter> {
  highlighter ??= import('./highlighter.js');
  return highlighter;
}

interface CodeLine {
  /** Highlighted HTML (escaped by highlight.js), or null → `text`. */
  html: string | null;
  text: string;
}

let nextId = 0;

/**
 * Code block (docs/06 §3): syntax highlighting (highlight.js, loaded lazily
 * on first use so it never lands in an app's initial bundle), optional line
 * numbers, emphasised lines (`highlightLines: "3,7-9"`) and an accessible
 * copy button whose result is announced. Until the highlighter has loaded,
 * and for unknown languages, the code renders as plain text.
 */
@Component({
  selector: 'cdf-lesson-code',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <figure
      class="cdf-code-block"
      [attr.data-language]="language()"
      [attr.aria-labelledby]="uid + '-lang'"
    >
      <figcaption class="cdf-code-block__bar">
        <span class="cdf-code-block__lang" [id]="uid + '-lang'">{{
          'ui.lesson.code.label' | translate: { language: label() }
        }}</span>
        @if (copyable()) {
          <button
            type="button"
            class="cdf-code-block__copy"
            [attr.data-state]="copyState()"
            (click)="copy()"
          >
            {{
              (copyState() === 'copied'
                ? 'ui.lesson.code.copied'
                : copyState() === 'failed'
                  ? 'ui.lesson.code.copyFailed'
                  : 'ui.lesson.code.copy'
              ) | translate
            }}
          </button>
        }
        <span class="cdf-code-block__sr" role="status">{{
          announcement()
        }}</span>
      </figcaption>
      <pre
        class="cdf-code"
        tabindex="0"
        [class.cdf-code--numbered]="showLineNumbers()"
        [attr.data-language]="language()"
        [attr.aria-labelledby]="uid + '-lang'"
      ><code [class]="'hljs language-' + language()">@for (line of lines(); track $index) {<span class="cdf-code__line" [class.cdf-code__line--hl]="emphasised().has($index + 1)" [attr.data-line]="$index + 1">@if (showLineNumbers()) {<span class="cdf-code__ln" aria-hidden="true">{{ $index + 1 }}</span>}@if (line.html !== null) {<span class="cdf-code__text" [innerHTML]="line.html"></span>} @else {<span class="cdf-code__text">{{ line.text }}</span>}</span>}</code></pre>
    </figure>
  `,
  styleUrl: './lesson-code-block.scss',
})
export class LessonCodeBlock {
  readonly node = input.required<CodeBlockNode>();

  private readonly doc = inject(DOCUMENT);
  private readonly i18n = inject(I18nService);
  protected readonly uid = `cdf-code-${nextId++}`;

  protected readonly code = computed(() =>
    (this.node().content ?? []).map((t) => t.text).join(''),
  );
  protected readonly language = computed(() => {
    const lang = canonicalCodeLanguage(this.node().attrs?.language);
    return /^[A-Za-z0-9+#._-]{1,40}$/.test(lang) ? lang : 'plaintext';
  });
  protected readonly label = computed(() =>
    codeLanguageLabel(this.node().attrs?.language),
  );
  protected readonly showLineNumbers = computed(
    () => this.node().attrs?.showLineNumbers === true,
  );
  protected readonly copyable = computed(
    () => this.node().attrs?.copyable !== false,
  );
  protected readonly emphasised = computed(() =>
    parseHighlightLines(this.node().attrs?.highlightLines),
  );

  private readonly highlighted = signal<{
    code: string;
    language: string;
    lines: string[] | null;
  } | null>(null);

  protected readonly lines = computed<CodeLine[]>(() => {
    const code = this.code();
    const plain = code.split('\n');
    const h = this.highlighted();
    const html =
      h && h.code === code && h.language === this.language() ? h.lines : null;
    return plain.map((text, i) => ({ text, html: html?.[i] ?? null }));
  });

  protected readonly copyState = signal<'idle' | 'copied' | 'failed'>('idle');
  protected readonly announcement = signal('');
  private resetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const code = this.code();
      const language = this.language();
      if (language === 'plaintext' || !code) return;
      void loadHighlighter()
        .then((m) =>
          this.highlighted.set({
            code,
            language,
            lines: m.highlightLines(code, language),
          }),
        )
        .catch(() => undefined); // chunk failed → stay plain text
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.resetTimer) clearTimeout(this.resetTimer);
    });
  }

  /** Copy the source to the clipboard; announces success / failure. */
  async copy(): Promise<void> {
    const ok = await this.writeClipboard(this.code());
    this.copyState.set(ok ? 'copied' : 'failed');
    this.announcement.set(
      this.i18n.t(
        ok ? 'ui.lesson.code.copiedAnnounce' : 'ui.lesson.code.copyFailed',
      ),
    );
    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      this.copyState.set('idle');
      this.announcement.set('');
    }, 2000);
  }

  private async writeClipboard(text: string): Promise<boolean> {
    const nav = this.doc.defaultView?.navigator;
    try {
      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* permission denied / insecure context → fallback */
    }
    try {
      const area = this.doc.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      this.doc.body.appendChild(area);
      area.select();
      const ok = this.doc.execCommand?.('copy') ?? false;
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
