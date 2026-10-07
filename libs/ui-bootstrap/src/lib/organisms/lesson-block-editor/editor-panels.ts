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
        {{ hasLink() ? 'Edit link' : 'Add link' }}
      </h3>
      <label class="cdf-editor-panel__field">
        <span>URL</span>
        <input
          type="text"
          inputmode="url"
          autocomplete="off"
          [value]="href()"
          [attr.aria-invalid]="showError() || null"
          [attr.aria-describedby]="uid + '-help'"
          placeholder="https://…, /path, #section or mailto:"
          (input)="href.set($any($event.target).value)"
        />
      </label>
      <p
        class="cdf-editor-panel__help"
        [class.cdf-editor-panel__help--error]="showError()"
        [id]="uid + '-help'"
      >
        @if (showError()) {
          Only http(s), mailto:, /relative paths and #anchors are allowed.
        } @else {
          Links to http(s), mailto:, /relative paths or #anchors.
        }
      </p>
      <label class="cdf-editor-panel__check">
        <input
          type="checkbox"
          [checked]="newTab()"
          (change)="newTab.set($any($event.target).checked)"
        />
        Open in a new tab
      </label>
      <div class="cdf-editor-panel__actions">
        @if (hasLink()) {
          <button
            type="button"
            class="cdf-editor-panel__btn cdf-editor-panel__btn--danger"
            (click)="unlink.emit()"
          >
            Remove link
          </button>
        }
        <span class="cdf-editor-panel__spacer"></span>
        <button
          type="button"
          class="cdf-editor-panel__btn"
          (click)="dismiss.emit()"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="cdf-editor-panel__btn cdf-editor-panel__btn--primary"
          [disabled]="!valid()"
        >
          Apply
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
        Insert image
      </h3>

      @if (canUpload) {
        <label class="cdf-editor-panel__field">
          <span>Upload a file (PNG, JPEG, WebP, GIF, SVG · max 10 MB)</span>
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
            <span>Uploading {{ fileName() }}…</span>
            @if (progress() !== null) {
              <progress
                max="100"
                [value]="progressPct()"
                [attr.aria-label]="'Upload progress ' + progressPct() + '%'"
              >
                {{ progressPct() }}%
              </progress>
            } @else {
              <progress aria-label="Uploading"></progress>
            }
            <button
              type="button"
              class="cdf-editor-panel__btn"
              (click)="abortUpload()"
            >
              Cancel upload
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
                Retry
              </button>
            }
          </div>
        }
        @case ('done') {
          <p class="cdf-editor-panel__help" role="status">
            Uploaded {{ fileName() }}.
          </p>
        }
      }

      <label class="cdf-editor-panel__field">
        <span>{{ canUpload ? '…or image URL' : 'Image URL' }}</span>
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
          Use an http(s) URL or a /relative path.
        </p>
      }

      @if (previewSrc(); as preview) {
        <img
          class="cdf-editor-panel__preview"
          [src]="preview"
          [alt]="alt() || 'Preview'"
        />
      }

      <label class="cdf-editor-panel__field">
        <span>Alt text (required)</span>
        <input
          type="text"
          [value]="alt()"
          placeholder="Describe the image"
          (input)="alt.set($any($event.target).value)"
        />
      </label>
      <label class="cdf-editor-panel__field">
        <span>Caption (optional)</span>
        <input
          type="text"
          [value]="caption()"
          (input)="caption.set($any($event.target).value)"
        />
      </label>
      <label class="cdf-editor-panel__field">
        <span>Width</span>
        <select
          [value]="width()"
          (change)="width.set($any($event.target).value)"
        >
          <option value="full">Full</option>
          <option value="wide">Wide</option>
          <option value="inline">Inline</option>
        </select>
      </label>

      <div class="cdf-editor-panel__actions">
        <span class="cdf-editor-panel__spacer"></span>
        <button
          type="button"
          class="cdf-editor-panel__btn"
          (click)="onCancel()"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="cdf-editor-panel__btn cdf-editor-panel__btn--primary"
          [disabled]="!canInsert()"
        >
          Insert image
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
      this.fail(`${file.name} is not a supported image type.`);
      return;
    }
    if (file.size > LESSON_IMAGE_MAX_BYTES) {
      this.fail(`${file.name} is larger than 10 MB.`);
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
        this.fail('The upload returned an unsupported URL.');
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
      this.fail(
        err instanceof Error && err.message
          ? `Upload failed: ${err.message}`
          : 'Upload failed.',
      );
    } finally {
      if (this.abort === abort) this.abort = null;
    }
  }

  private fail(message: string): void {
    this.status.set('error');
    this.error.set(message);
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
  template: `
    <form
      class="cdf-editor-panel"
      role="dialog"
      aria-modal="false"
      [attr.aria-labelledby]="uid + '-title'"
      (keydown.escape)="$event.preventDefault(); dismiss.emit()"
      (submit)="$event.preventDefault(); submit()"
    >
      <h3 class="cdf-editor-panel__title" [id]="uid + '-title'">Embed</h3>
      <label class="cdf-editor-panel__field">
        <span>URL</span>
        <input
          type="text"
          inputmode="url"
          [value]="url()"
          [attr.aria-invalid]="urlError() || null"
          [attr.aria-describedby]="uid + '-help'"
          placeholder="https://www.youtube.com/watch?v=…"
          (input)="url.set($any($event.target).value.trim())"
        />
      </label>
      <p
        class="cdf-editor-panel__help"
        [class.cdf-editor-panel__help--error]="urlError()"
        [id]="uid + '-help'"
      >
        @if (parsed(); as p) {
          Detected {{ label(p.provider) }}.
        } @else {
          YouTube, Vimeo, CodePen, CodeSandbox or Loom links only.
        }
      </p>
      <label class="cdf-editor-panel__field">
        <span>Title (read by screen readers)</span>
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
          Cancel
        </button>
        <button
          type="submit"
          class="cdf-editor-panel__btn cdf-editor-panel__btn--primary"
          [disabled]="!canInsert()"
        >
          Insert embed
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
