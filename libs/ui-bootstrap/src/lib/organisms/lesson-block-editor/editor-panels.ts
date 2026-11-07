/**
 * Inline, non-modal dialogs the lesson editor opens under its toolbar:
 * link editing (replaces `window.prompt`), image insert (upload through
 * `LESSON_ASSET_UPLOADER` or URL) and embed insert. Each focuses its first
 * field on open, closes on Escape and reports through outputs; the editor
 * restores focus to the document afterwards.
 */

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  EMBED_PROVIDER_LABELS,
  isAllowedHref,
  isAllowedImageSrc,
  parseEmbedUrl,
  type EmbedProvider,
  type ImageWidth,
} from '@codify/lesson-schema';
import { I18nService, TranslatePipe } from '@codify/i18n';
import {
  LESSON_ASSET_UPLOADER,
  LESSON_IMAGE_MAX_BYTES,
  LESSON_IMAGE_TYPES,
} from './lesson-asset-uploader.js';

let nextId = 0;

function focusFirstField(host: ElementRef<HTMLElement>): void {
  afterNextRender(() => {
    host.nativeElement
      .querySelector<HTMLElement>('input, select, textarea, button')
      ?.focus();
  });
}

// ─── Link ──────────────────────────────────────────────────────────────────

export interface LinkPanelResult {
  href: string;
  newTab: boolean;
}

@Component({
  selector: 'cdf-link-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <form
      class="cdf-editor-panel"
      role="dialog"
      aria-modal="false"
      [attr.aria-labelledby]="uid + '-title'"
      (keydown.escape)="$event.preventDefault(); dismiss.emit()"
      (submit)="$event.preventDefault(); submit()"
    >
      <h3 class="cdf-editor-panel__title" [id]="uid + '-title'">
        {{
          (hasLink()
            ? 'ui.lessonEditor.link.titleEdit'
            : 'ui.lessonEditor.link.titleAdd'
          ) | translate
        }}
      </h3>
      <label class="cdf-editor-panel__field">
        <span>{{ 'ui.lessonEditor.panel.url' | translate }}</span>
        <input
          type="text"
          inputmode="url"
          autocomplete="off"
          [value]="href()"
          [attr.aria-invalid]="showError() || null"
          [attr.aria-describedby]="uid + '-help'"
          [placeholder]="'ui.lessonEditor.link.urlPlaceholder' | translate"
          (input)="href.set($any($event.target).value)"
        />
      </label>
      <p
        class="cdf-editor-panel__help"
        [class.cdf-editor-panel__help--error]="showError()"
        [id]="uid + '-help'"
      >
        {{
          (showError()
            ? 'ui.lessonEditor.link.invalid'
            : 'ui.lessonEditor.link.help'
          ) | translate
        }}
      </p>
      <label class="cdf-editor-panel__check">
        <input
          type="checkbox"
          [checked]="newTab()"
          (change)="newTab.set($any($event.target).checked)"
        />
        {{ 'ui.lessonEditor.link.newTab' | translate }}
      </label>
      <div class="cdf-editor-panel__actions">
        @if (hasLink()) {
          <button
            type="button"
            class="cdf-editor-panel__btn cdf-editor-panel__btn--danger"
            (click)="unlink.emit()"
          >
            {{ 'ui.lessonEditor.link.remove' | translate }}
          </button>
        }
        <span class="cdf-editor-panel__spacer"></span>
        <button
          type="button"
          class="cdf-editor-panel__btn"
          (click)="dismiss.emit()"
        >
          {{ 'ui.lessonEditor.panel.cancel' | translate }}
        </button>
        <button
          type="submit"
          class="cdf-editor-panel__btn cdf-editor-panel__btn--primary"
          [disabled]="!valid()"
        >
          {{ 'ui.lessonEditor.panel.apply' | translate }}
        </button>
      </div>
    </form>
  `,
  styleUrl: './editor-panels.scss',
})
export class LinkPanel {
  readonly initialHref = input('');
  readonly initialNewTab = input(false);
  readonly hasLink = input(false);

  readonly apply = output<LinkPanelResult>();
  readonly unlink = output<void>();
  readonly dismiss = output<void>();

  protected readonly uid = `cdf-link-panel-${nextId++}`;
  protected readonly href = signal('');
  protected readonly newTab = signal(false);
  protected readonly valid = computed(() => isAllowedHref(this.href().trim()));
  protected readonly showError = computed(
    () => this.href().trim() !== '' && !this.valid(),
  );

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    afterNextRender(() => {
      this.href.set(this.initialHref());
      this.newTab.set(this.initialNewTab());
    });
    focusFirstField(host);
  }

  protected submit(): void {
    if (!this.valid()) return;
    this.apply.emit({ href: this.href().trim(), newTab: this.newTab() });
  }
}

// ─── Image ─────────────────────────────────────────────────────────────────

export interface ImagePanelResult {
  src: string;
  alt: string;
  caption: string | null;
  assetId: string | null;
  width: ImageWidth;
}

type UploadStatus = 'idle' | 'uploading' | 'done' | 'error';

@Component({
  selector: 'cdf-image-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <form
      class="cdf-editor-panel"
      role="dialog"
      aria-modal="false"
      [attr.aria-labelledby]="uid + '-title'"
      (keydown.escape)="$event.preventDefault(); onCancel()"
      (submit)="$event.preventDefault(); submit()"
    >
      <h3 class="cdf-editor-panel__title" [id]="uid + '-title'">
        {{ 'ui.lessonEditor.image.title' | translate }}
      </h3>

      @if (canUpload) {
        <label class="cdf-editor-panel__field">
          <span>{{ 'ui.lessonEditor.image.upload' | translate }}</span>
          <input
            type="file"
            [accept]="accept"
            [disabled]="status() === 'uploading'"
            (change)="onFile($event)"
          />
        </label>
      }

      @switch (status()) {
        @case ('uploading') {
          <div class="cdf-editor-panel__progress" role="status">
            <span>{{
              'ui.lessonEditor.image.uploading'
                | translate: { name: fileName() }
            }}</span>
            @if (progress() !== null) {
              <progress
                max="100"
                [value]="progressPct()"
                [attr.aria-label]="
                  'ui.lessonEditor.image.progress'
                    | translate: { pct: progressPct() }
                "
              >
                {{ progressPct() }}%
              </progress>
            } @else {
              <progress
                [attr.aria-label]="
                  'ui.lessonEditor.image.progressIndeterminate' | translate
                "
              ></progress>
            }
            <button
              type="button"
              class="cdf-editor-panel__btn"
              (click)="abortUpload()"
            >
              {{ 'ui.lessonEditor.image.cancelUpload' | translate }}
            </button>
          </div>
        }
        @case ('error') {
          <div class="cdf-editor-panel__error" role="alert">
            <span>{{ error() }}</span>
            @if (lastFile) {
              <button
                type="button"
                class="cdf-editor-panel__btn"
                (click)="retry()"
              >
                {{ 'ui.lessonEditor.image.retry' | translate }}
              </button>
            }
          </div>
        }
        @case ('done') {
          <p class="cdf-editor-panel__help" role="status">
            {{
              'ui.lessonEditor.image.uploaded' | translate: { name: fileName() }
            }}
          </p>
        }
      }

      <label class="cdf-editor-panel__field">
        <span>{{
          (canUpload
            ? 'ui.lessonEditor.image.orUrl'
            : 'ui.lessonEditor.image.url'
          ) | translate
        }}</span>
        <input
          type="text"
          inputmode="url"
          [value]="src()"
          [readOnly]="status() === 'uploading'"
          [attr.aria-invalid]="srcError() || null"
          placeholder="https://…"
          (input)="onUrl($any($event.target).value)"
        />
      </label>
      @if (srcError()) {
        <p class="cdf-editor-panel__help cdf-editor-panel__help--error">
          {{ 'ui.lessonEditor.image.urlInvalid' | translate }}
        </p>
      }

      @if (previewSrc(); as preview) {
        <img
          class="cdf-editor-panel__preview"
          [src]="preview"
          [alt]="alt() || ('ui.lessonEditor.image.previewAlt' | translate)"
        />
      }

      <label class="cdf-editor-panel__field">
        <span>{{ 'ui.lessonEditor.image.alt' | translate }}</span>
        <input
          type="text"
          [value]="alt()"
          [placeholder]="'ui.lessonEditor.image.altPlaceholder' | translate"
          (input)="alt.set($any($event.target).value)"
        />
      </label>
      <label class="cdf-editor-panel__field">
        <span>{{ 'ui.lessonEditor.image.caption' | translate }}</span>
        <input
          type="text"
          [value]="caption()"
          (input)="caption.set($any($event.target).value)"
        />
      </label>
      <label class="cdf-editor-panel__field">
        <span>{{ 'ui.lessonEditor.image.width' | translate }}</span>
        <select
          [value]="width()"
          (change)="width.set($any($event.target).value)"
        >
          <option value="full">
            {{ 'ui.lessonEditor.image.widths.full' | translate }}
          </option>
          <option value="wide">
            {{ 'ui.lessonEditor.image.widths.wide' | translate }}
          </option>
          <option value="inline">
            {{ 'ui.lessonEditor.image.widths.inline' | translate }}
          </option>
        </select>
      </label>

      <div class="cdf-editor-panel__actions">
        <span class="cdf-editor-panel__spacer"></span>
        <button
          type="button"
          class="cdf-editor-panel__btn"
          (click)="onCancel()"
        >
          {{ 'ui.lessonEditor.panel.cancel' | translate }}
        </button>
        <button
          type="submit"
          class="cdf-editor-panel__btn cdf-editor-panel__btn--primary"
          [disabled]="!canInsert()"
        >
          {{ 'ui.lessonEditor.image.insert' | translate }}
        </button>
      </div>
    </form>
  `,
  styleUrl: './editor-panels.scss',
})
export class ImagePanel implements OnDestroy {
  readonly insert = output<ImagePanelResult>();
  readonly dismiss = output<void>();

  private readonly uploader = inject(LESSON_ASSET_UPLOADER, { optional: true });
  private readonly i18n = inject(I18nService);
  protected readonly canUpload = !!this.uploader;
  protected readonly accept = LESSON_IMAGE_TYPES.join(',');
  protected readonly uid = `cdf-image-panel-${nextId++}`;

  protected readonly src = signal('');
  protected readonly assetId = signal<string | null>(null);
  protected readonly alt = signal('');
  protected readonly caption = signal('');
  protected readonly width = signal<ImageWidth>('full');
  protected readonly status = signal<UploadStatus>('idle');
  protected readonly progress = signal<number | null>(null);
  protected readonly error = signal('');
  protected readonly fileName = signal('');
  protected lastFile: File | null = null;
  private abort: AbortController | null = null;

  protected readonly progressPct = computed(() =>
    Math.round((this.progress() ?? 0) * 100),
  );
  protected readonly srcError = computed(
    () => this.src() !== '' && !isAllowedImageSrc(this.src()),
  );
  protected readonly previewSrc = computed(() =>
    isAllowedImageSrc(this.src()) ? this.src() : null,
  );
  protected readonly canInsert = computed(
    () =>
      this.status() !== 'uploading' &&
      isAllowedImageSrc(this.src()) &&
      this.alt().trim() !== '',
  );

  constructor() {
    focusFirstField(inject<ElementRef<HTMLElement>>(ElementRef));
  }

  ngOnDestroy(): void {
    this.abort?.abort();
  }

  protected onUrl(value: string): void {
    this.src.set(value.trim());
    this.assetId.set(null);
    if (this.status() !== 'uploading') this.status.set('idle');
  }

  protected onFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void this.upload(file);
  }

  protected retry(): void {
    if (this.lastFile) void this.upload(this.lastFile);
  }

  protected abortUpload(): void {
    this.abort?.abort();
  }

  protected onCancel(): void {
    this.abort?.abort();
    this.dismiss.emit();
  }

  /** Validate + upload; exposed for tests. */
  async upload(file: File): Promise<void> {
    this.lastFile = file;
    this.fileName.set(file.name);
    if (!(LESSON_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      this.fail('ui.lessonEditor.image.errors.type', { name: file.name });
      return;
    }
    if (file.size > LESSON_IMAGE_MAX_BYTES) {
      this.fail('ui.lessonEditor.image.errors.size', { name: file.name });
      return;
    }
    if (!this.uploader) return;
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    this.status.set('uploading');
    this.progress.set(null);
    this.error.set('');
    try {
      const res = await this.uploader.upload(file, {
        signal: abort.signal,
        onProgress: (f) => this.progress.set(Math.max(0, Math.min(1, f))),
      });
      if (abort.signal.aborted) return;
      if (!isAllowedImageSrc(res.url)) {
        this.fail('ui.lessonEditor.image.errors.url');
        return;
      }
      this.src.set(res.url);
      this.assetId.set(res.assetId);
      this.status.set('done');
    } catch (err) {
      if (abort.signal.aborted) {
        this.status.set('idle');
        return;
      }
      if (err instanceof Error && err.message)
        this.fail('ui.lessonEditor.image.errors.failedWith', {
          message: err.message,
        });
      else this.fail('ui.lessonEditor.image.errors.failed');
    } finally {
      if (this.abort === abort) this.abort = null;
    }
  }

  /** Show a translated error (a `ui.lessonEditor.image.errors.*` key). */
  private fail(key: string, params?: Record<string, unknown>): void {
    this.status.set('error');
    this.error.set(this.i18n.t(key, params));
  }

  protected submit(): void {
    if (!this.canInsert()) return;
    this.insert.emit({
      src: this.src(),
      alt: this.alt().trim(),
      caption: this.caption().trim() || null,
      assetId: this.assetId(),
      width: this.width(),
    });
  }
}

// ─── Embed ─────────────────────────────────────────────────────────────────

export interface EmbedPanelResult {
  provider: EmbedProvider;
  url: string;
  title: string;
}

@Component({
  selector: 'cdf-embed-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <form
      class="cdf-editor-panel"
      role="dialog"
      aria-modal="false"
      [attr.aria-labelledby]="uid + '-title'"
      (keydown.escape)="$event.preventDefault(); dismiss.emit()"
      (submit)="$event.preventDefault(); submit()"
    >
      <h3 class="cdf-editor-panel__title" [id]="uid + '-title'">
        {{ 'ui.lessonEditor.embed.title' | translate }}
      </h3>
      <label class="cdf-editor-panel__field">
        <span>{{ 'ui.lessonEditor.panel.url' | translate }}</span>
        <input
          type="text"
          inputmode="url"
          [value]="url()"
          [attr.aria-invalid]="urlError() || null"
          [attr.aria-describedby]="uid + '-help'"
          [placeholder]="'ui.lessonEditor.embed.urlPlaceholder' | translate"
          (input)="url.set($any($event.target).value.trim())"
        />
      </label>
      <p
        class="cdf-editor-panel__help"
        [class.cdf-editor-panel__help--error]="urlError()"
        [id]="uid + '-help'"
      >
        @if (parsed(); as p) {
          {{
            'ui.lessonEditor.embed.detected'
              | translate: { provider: label(p.provider) }
          }}
        } @else {
          {{ 'ui.lessonEditor.embed.help' | translate }}
        }
      </p>
      <label class="cdf-editor-panel__field">
        <span>{{ 'ui.lessonEditor.embed.titleLabel' | translate }}</span>
        <input
          type="text"
          [value]="title()"
          (input)="title.set($any($event.target).value)"
        />
      </label>
      <div class="cdf-editor-panel__actions">
        <span class="cdf-editor-panel__spacer"></span>
        <button
          type="button"
          class="cdf-editor-panel__btn"
          (click)="dismiss.emit()"
        >
          {{ 'ui.lessonEditor.panel.cancel' | translate }}
        </button>
        <button
          type="submit"
          class="cdf-editor-panel__btn cdf-editor-panel__btn--primary"
          [disabled]="!canInsert()"
        >
          {{ 'ui.lessonEditor.embed.insert' | translate }}
        </button>
      </div>
    </form>
  `,
  styleUrl: './editor-panels.scss',
})
export class EmbedPanel {
  readonly insert = output<EmbedPanelResult>();
  readonly dismiss = output<void>();

  protected readonly uid = `cdf-embed-panel-${nextId++}`;
  protected readonly url = signal('');
  protected readonly title = signal('');
  protected readonly parsed = computed(() => parseEmbedUrl(this.url()));
  protected readonly urlError = computed(
    () => this.url() !== '' && !this.parsed(),
  );
  protected readonly canInsert = computed(
    () => !!this.parsed() && this.title().trim() !== '',
  );

  constructor() {
    focusFirstField(inject<ElementRef<HTMLElement>>(ElementRef));
  }

  protected label(p: EmbedProvider): string {
    return EMBED_PROVIDER_LABELS[p];
  }

  protected submit(): void {
    const parsed = this.parsed();
    if (!parsed || !this.title().trim()) return;
    this.insert.emit({
      provider: parsed.provider,
      url: this.url(),
      title: this.title().trim(),
    });
  }
}
