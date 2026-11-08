import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import {
  EMBED_ASPECT_RATIOS,
  EMBED_PROVIDER_LABELS,
  IMAGE_ALIGNS,
  type EmbedProvider,
} from '@codify/lesson-schema';
import { EditorIcon } from '../block-toolbar/editor-icon.js';
import { CODE_LANGUAGES } from '../lesson-block-renderer/code/code-languages.js';

/** The top-level block the properties panel edits. */
export interface SelectedBlock {
  /** Doc position of the block. */
  pos: number;
  /** 0-based index among the doc's top-level blocks. */
  index: number;
  total: number;
  type: string;
  attrs: Record<string, unknown>;
  /** table: size. */
  rows?: number;
  cols?: number;
}

const CALLOUT_KINDS = ['info', 'tip', 'warn', 'danger', 'success'] as const;
const HIGHLIGHT_SPEC = /^[\d,\s-]*$/;
let nextId = 0;

/**
 * Right-side, sticky properties panel of the lesson editor (docs/06 §9):
 * the attributes of the block holding the cursor (heading level, callout
 * kind, code language / line numbers / highlighted lines / copy button,
 * image alt / caption / width / align, embed title / aspect ratio, video
 * title / caption) plus move up / down and delete. Presentational: every
 * change goes out through `patch`, `move` or `remove`.
 */
@Component({
  selector: 'cdf-block-properties',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, EditorIcon],
  template: `
    <section class="cdf-props" [attr.aria-labelledby]="uid + '-title'">
      <h3 class="cdf-props__title" [id]="uid + '-title'">
        {{ 'ui.lessonEditor.props.title' | translate }}
      </h3>
      @if (block(); as b) {
        <p class="cdf-props__type">
          <strong>{{
            'ui.lessonEditor.props.types.' + b.type | translate
          }}</strong>
          <span class="cdf-props__muted">{{
            'ui.lessonEditor.props.position'
              | translate: { n: b.index + 1, total: b.total }
          }}</span>
        </p>

        @switch (b.type) {
          @case ('heading') {
            <label class="cdf-props__field">
              <span>{{ 'ui.lessonEditor.props.level' | translate }}</span>
              <select
                [value]="'' + (b.attrs['level'] ?? 2)"
                [disabled]="disabled()"
                (change)="emit({ level: +$any($event.target).value })"
              >
                @for (l of ['2', '3']; track l) {
                  <option [value]="l" [selected]="'' + b.attrs['level'] === l">
                    {{ 'ui.lessonEditor.props.levels.' + l | translate }}
                  </option>
                }
              </select>
            </label>
          }
          @case ('callout') {
            <label class="cdf-props__field">
              <span>{{ 'ui.lessonEditor.props.calloutKind' | translate }}</span>
              <select
                [value]="b.attrs['kind'] ?? 'info'"
                [disabled]="disabled()"
                (change)="emit({ kind: $any($event.target).value })"
              >
                @for (k of calloutKinds; track k) {
                  <option [value]="k" [selected]="b.attrs['kind'] === k">
                    {{ 'ui.lessonEditor.props.calloutKinds.' + k | translate }}
                  </option>
                }
              </select>
            </label>
          }
          @case ('codeBlock') {
            <label class="cdf-props__field">
              <span>{{ 'ui.lessonEditor.props.language' | translate }}</span>
              <select
                data-testid="code-language"
                [value]="b.attrs['language'] ?? 'plaintext'"
                [disabled]="disabled()"
                (change)="emit({ language: $any($event.target).value })"
              >
                @for (l of languages; track l.id) {
                  <option
                    [value]="l.id"
                    [selected]="(b.attrs['language'] ?? 'plaintext') === l.id"
                  >
                    {{ l.label }}
                  </option>
                }
                @if (unknownLanguage(); as other) {
                  <option [value]="other" selected>{{ other }}</option>
                }
              </select>
            </label>
            <label class="cdf-props__check">
              <input
                type="checkbox"
                [checked]="b.attrs['showLineNumbers'] === true"
                [disabled]="disabled()"
                (change)="
                  emit({ showLineNumbers: $any($event.target).checked })
                "
              />
              {{ 'ui.lessonEditor.props.lineNumbers' | translate }}
            </label>
            <label class="cdf-props__field">
              <span>{{
                'ui.lessonEditor.props.highlightLines' | translate
              }}</span>
              <input
                type="text"
                inputmode="numeric"
                [value]="b.attrs['highlightLines'] ?? ''"
                [disabled]="disabled()"
                [attr.aria-describedby]="uid + '-hl-help'"
                [attr.aria-invalid]="hlInvalid() || null"
                placeholder="3,7-9"
                (input)="setHighlight($any($event.target).value)"
              />
            </label>
            <p
              class="cdf-props__help"
              [class.cdf-props__help--error]="hlInvalid()"
              [id]="uid + '-hl-help'"
            >
              {{
                (hlInvalid()
                  ? 'ui.lessonEditor.props.highlightInvalid'
                  : 'ui.lessonEditor.props.highlightHelp'
                ) | translate
              }}
            </p>
            <label class="cdf-props__check">
              <input
                type="checkbox"
                [checked]="b.attrs['copyable'] !== false"
                [disabled]="disabled()"
                (change)="emit({ copyable: $any($event.target).checked })"
              />
              {{ 'ui.lessonEditor.props.copyable' | translate }}
            </label>
          }
          @case ('image') {
            <label class="cdf-props__field">
              <span>{{ 'ui.lessonEditor.image.alt' | translate }}</span>
              <input
                type="text"
                [value]="b.attrs['alt'] ?? ''"
                [disabled]="disabled()"
                [attr.aria-invalid]="
                  !('' + (b.attrs['alt'] ?? '')).trim() || null
                "
                (input)="emit({ alt: $any($event.target).value })"
              />
            </label>
            <label class="cdf-props__field">
              <span>{{ 'ui.lessonEditor.image.caption' | translate }}</span>
              <input
                type="text"
                [value]="b.attrs['caption'] ?? ''"
                [disabled]="disabled()"
                (input)="emitText('caption', $any($event.target).value)"
              />
            </label>
            <label class="cdf-props__field">
              <span>{{ 'ui.lessonEditor.image.width' | translate }}</span>
              <select
                [value]="b.attrs['width'] ?? 'full'"
                [disabled]="disabled()"
                (change)="emit({ width: $any($event.target).value })"
              >
                @for (w of widths; track w) {
                  <option
                    [value]="w"
                    [selected]="(b.attrs['width'] ?? 'full') === w"
                  >
                    {{ 'ui.lessonEditor.image.widths.' + w | translate }}
                  </option>
                }
              </select>
            </label>
            <label class="cdf-props__field">
              <span>{{ 'ui.lessonEditor.image.align' | translate }}</span>
              <select
                [value]="b.attrs['align'] ?? 'center'"
                [disabled]="disabled()"
                (change)="emit({ align: $any($event.target).value })"
              >
                @for (a of aligns; track a) {
                  <option
                    [value]="a"
                    [selected]="(b.attrs['align'] ?? 'center') === a"
                  >
                    {{ 'ui.lessonEditor.image.aligns.' + a | translate }}
                  </option>
                }
              </select>
            </label>
          }
          @case ('embed') {
            <p class="cdf-props__muted">
              {{ 'ui.lessonEditor.props.embedProvider' | translate }}:
              {{ providerLabel(b.attrs['provider']) }}
            </p>
            <label class="cdf-props__field">
              <span>{{ 'ui.lessonEditor.embed.titleLabel' | translate }}</span>
              <input
                type="text"
                [value]="b.attrs['title'] ?? ''"
                [disabled]="disabled()"
                (input)="emit({ title: $any($event.target).value })"
              />
            </label>
            <label class="cdf-props__field">
              <span>{{ 'ui.lessonEditor.embed.aspectRatio' | translate }}</span>
              <select
                [value]="b.attrs['aspectRatio'] ?? '16:9'"
                [disabled]="disabled() || locked()"
                (change)="emit({ aspectRatio: $any($event.target).value })"
              >
                @for (r of ratios; track r) {
                  <option
                    [value]="r"
                    [selected]="(b.attrs['aspectRatio'] ?? '16:9') === r"
                  >
                    {{ r }}
                  </option>
                }
              </select>
            </label>
            @if (metaTitle(); as t) {
              <p class="cdf-props__muted">
                {{
                  'ui.lessonEditor.props.embedMeta' | translate: { title: t }
                }}
              </p>
            }
          }
          @case ('videoBlock') {
            <label class="cdf-props__field">
              <span>{{ 'ui.lessonEditor.video.titleLabel' | translate }}</span>
              <input
                type="text"
                [value]="b.attrs['title'] ?? ''"
                [disabled]="disabled()"
                (input)="emit({ title: $any($event.target).value })"
              />
            </label>
            <label class="cdf-props__field">
              <span>{{ 'ui.lessonEditor.image.caption' | translate }}</span>
              <input
                type="text"
                [value]="b.attrs['caption'] ?? ''"
                [disabled]="disabled()"
                (input)="emitText('caption', $any($event.target).value)"
              />
            </label>
          }
          @case ('quiz') {
            <p class="cdf-props__muted">
              {{ 'ui.lessonEditor.props.quizKind' | translate }}:
              {{
                'ui.lessonEditor.quiz.kinds.' + (b.attrs['kind'] ?? 'single')
                  | translate
              }}
            </p>
            <p class="cdf-props__help">
              {{ 'ui.lessonEditor.props.quizHint' | translate }}
            </p>
          }
          @case ('table') {
            <p class="cdf-props__muted">
              {{
                'ui.lessonEditor.props.tableSize'
                  | translate: { rows: b.rows ?? 0, cols: b.cols ?? 0 }
              }}
            </p>
          }
          @default {
            @if (refId(); as id) {
              <p class="cdf-props__muted">
                {{ 'ui.lessonEditor.props.refId' | translate }}:
                <code>{{ id }}</code>
              </p>
            } @else {
              <p class="cdf-props__help">
                {{ 'ui.lessonEditor.props.noFields' | translate }}
              </p>
            }
          }
        }

        @if (!locked()) {
          <div class="cdf-props__actions">
            <button
              type="button"
              class="cdf-props__btn"
              [disabled]="disabled() || b.index === 0"
              (click)="move.emit(-1)"
            >
              <cdf-editor-icon name="ArrowUp" size="16" />
              {{ 'ui.lessonEditor.props.moveUp' | translate }}
            </button>
            <button
              type="button"
              class="cdf-props__btn"
              [disabled]="disabled() || b.index >= b.total - 1"
              (click)="move.emit(1)"
            >
              <cdf-editor-icon name="ArrowDown" size="16" />
              {{ 'ui.lessonEditor.props.moveDown' | translate }}
            </button>
            <button
              type="button"
              class="cdf-props__btn cdf-props__btn--danger"
              [disabled]="disabled()"
              (click)="remove.emit()"
            >
              <cdf-editor-icon name="Trash" size="16" />
              {{ 'ui.lessonEditor.props.delete' | translate }}
            </button>
          </div>
        }
      } @else {
        <p class="cdf-props__help">
          {{ 'ui.lessonEditor.props.none' | translate }}
        </p>
      }
    </section>
  `,
  styleUrl: './block-properties.scss',
})
export class BlockProperties {
  readonly block = input<SelectedBlock | null>(null);
  readonly disabled = input(false);
  /** Translation mode: structural controls are hidden / disabled. */
  readonly locked = input(false);

  readonly patch = output<Record<string, unknown>>();
  readonly move = output<-1 | 1>();
  readonly remove = output<void>();

  protected readonly uid = `cdf-props-${nextId++}`;
  protected readonly languages = CODE_LANGUAGES;
  protected readonly calloutKinds = CALLOUT_KINDS;
  protected readonly widths = ['full', 'wide', 'inline'] as const;
  protected readonly aligns = IMAGE_ALIGNS;
  protected readonly ratios = EMBED_ASPECT_RATIOS;

  private readonly blockPos = computed(() => this.block()?.pos ?? -1);
  /** What the author typed into "highlight lines" (may be invalid). */
  private readonly hlDraft = signal<string | null>(null);
  protected readonly hlInvalid = computed(() => {
    const v = this.hlDraft();
    return v !== null && !HIGHLIGHT_SPEC.test(v);
  });

  constructor() {
    // A different block → forget the draft.
    effect(() => {
      this.blockPos();
      this.hlDraft.set(null);
    });
  }
  protected readonly unknownLanguage = computed(() => {
    const b = this.block();
    const lang =
      b?.type === 'codeBlock' ? String(b.attrs['language'] ?? '') : '';
    return lang && !CODE_LANGUAGES.some((l) => l.id === lang) ? lang : null;
  });
  protected readonly metaTitle = computed(() => {
    const meta = this.block()?.attrs['meta'] as { title?: string } | null;
    return meta?.title ?? null;
  });
  protected readonly refId = computed(() => {
    const a = this.block()?.attrs ?? {};
    const id = a['exerciseId'] ?? a['aiPromptId'] ?? a['scenarioId'];
    return typeof id === 'string' && id ? id : null;
  });

  protected emit(patch: Record<string, unknown>): void {
    this.patch.emit(patch);
  }

  protected emitText(key: string, value: string): void {
    this.patch.emit({ [key]: value.trim() ? value : null });
  }

  protected setHighlight(value: string): void {
    // Invalid specs stay in the field (aria-invalid) but are never stored.
    this.hlDraft.set(value);
    if (!HIGHLIGHT_SPEC.test(value)) return;
    this.patch.emit({ highlightLines: value.trim() ? value.trim() : null });
  }

  protected providerLabel(p: unknown): string {
    return EMBED_PROVIDER_LABELS[p as EmbedProvider] ?? String(p ?? '');
  }
}
