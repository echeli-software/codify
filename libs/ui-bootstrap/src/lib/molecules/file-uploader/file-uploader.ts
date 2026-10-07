import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { I18nService, TranslatePipe } from '@codify/i18n';
import type { Subscription } from 'rxjs';
import { Icon } from '../../atoms/icon/icon.js';
import { IconButton } from '../../atoms/icon-button/icon-button.js';
import { ProgressBar } from '../../atoms/progress-bar/progress-bar.js';
import {
  FILE_UPLOADER,
  type FileUploaderBackend,
} from './file-uploader.token.js';

export type UploadStatus = 'uploading' | 'done' | 'error' | 'rejected';

export interface UploadItem<R = unknown> {
  id: number;
  file: File;
  status: UploadStatus;
  /** 0–100. */
  progress: number;
  result?: R;
  /** i18n key explaining a rejection / failure. */
  errorKey?: string;
  errorParams?: Record<string, unknown>;
}

let uploaderSeq = 0;
let itemSeq = 0;

/**
 * Drag-and-drop + click-to-browse uploader with per-file progress. The
 * actual transfer is delegated to the injected `FILE_UPLOADER` backend (or
 * the `backend` input), so the same molecule serves course covers, item
 * sprites and the media library.
 *
 *   <cdf-file-uploader accept="image/*" [maxSizeBytes]="5_000_000" (uploaded)="onAsset($event)" />
 *
 * Accessibility: the drop zone is a labelled native file input (keyboard /
 * screen-reader operable); progress is announced through a live region.
 */
@Component({
  selector: 'cdf-file-uploader',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, IconButton, ProgressBar, TranslatePipe],
  template: `
    <div
      class="cdf-uploader"
      [class.cdf-uploader--over]="dragOver()"
      [class.cdf-uploader--disabled]="disabled()"
      (dragenter)="onDrag($event, true)"
      (dragover)="onDrag($event, true)"
      (dragleave)="onDrag($event, false)"
      (drop)="onDrop($event)"
    >
      <cdf-icon name="upload" size="lg" class="cdf-uploader__icon" />
      <label class="cdf-uploader__label" [for]="inputId">
        <span class="cdf-uploader__cta">{{
          'ui.uploader.browse' | translate
        }}</span>
        {{ 'ui.uploader.orDrop' | translate }}
      </label>
      <input
        class="cdf-uploader__input"
        type="file"
        [id]="inputId"
        [accept]="accept() ?? ''"
        [multiple]="multiple()"
        [disabled]="disabled()"
        [attr.aria-describedby]="hintId"
        (change)="onPick($event)"
      />
      <p class="cdf-uploader__hint" [id]="hintId">
        @if (hint(); as h) {
          {{ h }}
        } @else if (maxSizeBytes(); as max) {
          {{ 'ui.uploader.maxSize' | translate: { size: formatSize(max) } }}
        }
      </p>
    </div>

    @if (!backend() && !injected) {
      <p class="cdf-uploader__error" role="alert">
        {{ 'ui.uploader.noBackend' | translate }}
      </p>
    }

    @if (items().length) {
      <ul class="cdf-uploader__list" aria-live="polite">
        @for (item of items(); track item.id) {
          <li
            class="cdf-uploader__item"
            [class]="'cdf-uploader__item--' + item.status"
          >
            <cdf-icon [name]="iconFor(item)" size="sm" />
            <span class="cdf-uploader__name">{{ item.file.name }}</span>
            <span class="cdf-uploader__size">{{
              formatSize(item.file.size)
            }}</span>
            @switch (item.status) {
              @case ('uploading') {
                <cdf-progress-bar
                  class="cdf-uploader__progress"
                  size="sm"
                  [value]="item.progress"
                  [label]="
                    'ui.uploader.uploading'
                      | translate: { name: item.file.name }
                  "
                />
              }
              @case ('done') {
                <span class="cdf-uploader__status">{{
                  'ui.uploader.done' | translate
                }}</span>
              }
              @default {
                <span class="cdf-uploader__status cdf-uploader__status--error">
                  {{
                    item.errorKey ?? 'ui.uploader.failed'
                      | translate: item.errorParams
                  }}
                </span>
              }
            }
            @if (item.status !== 'uploading') {
              <cdf-icon-button
                icon="x"
                size="sm"
                [ariaLabel]="
                  'ui.uploader.removeItem' | translate: { name: item.file.name }
                "
                (click)="dismiss(item.id)"
              />
            }
          </li>
        }
      </ul>
    }
  `,
  styleUrl: './file-uploader.scss',
})
export class FileUploader<R = unknown> {
  private readonly i18n = inject(I18nService);
  protected readonly injected = inject(FILE_UPLOADER, { optional: true });

  /** `accept` attribute, e.g. `image/*` or `.png,.svg`. */
  readonly accept = input<string | null>(null);
  readonly multiple = input(false);
  readonly maxSizeBytes = input<number | null>(null);
  readonly disabled = input(false);
  readonly hint = input<string | null>(null);
  /** Overrides the injected `FILE_UPLOADER`. */
  readonly backend = input<FileUploaderBackend<R> | null>(null);

  readonly uploaded = output<R>();
  readonly failed = output<{ file: File; error: unknown }>();

  protected readonly inputId = `cdf-uploader-${++uploaderSeq}`;
  protected readonly hintId = `${this.inputId}-hint`;
  protected readonly dragOver = signal(false);
  protected readonly items = signal<UploadItem<R>[]>([]);
  private readonly subs = new Map<number, Subscription>();

  protected readonly busy = computed(() =>
    this.items().some((i) => i.status === 'uploading'),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() =>
      this.subs.forEach((s) => s.unsubscribe()),
    );
  }

  /** Programmatic entry point (e.g. paste handler). */
  addFiles(files: Iterable<File>): void {
    const list = [...files];
    for (const file of this.multiple() ? list : list.slice(0, 1))
      this.start(file);
  }

  protected onDrag(ev: DragEvent, over: boolean): void {
    ev.preventDefault();
    if (!this.disabled()) this.dragOver.set(over);
  }

  protected onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOver.set(false);
    if (this.disabled()) return;
    const files = ev.dataTransfer?.files;
    if (files?.length) this.addFiles(Array.from(files));
  }

  protected onPick(ev: Event): void {
    const inputEl = ev.target as HTMLInputElement;
    if (inputEl.files?.length) this.addFiles(Array.from(inputEl.files));
    inputEl.value = '';
  }

  protected dismiss(id: number): void {
    this.subs.get(id)?.unsubscribe();
    this.subs.delete(id);
    this.items.update((list) => list.filter((i) => i.id !== id));
  }

  protected iconFor(item: UploadItem<R>): 'check-circle' | 'x-circle' | 'file' {
    if (item.status === 'done') return 'check-circle';
    if (item.status === 'error' || item.status === 'rejected')
      return 'x-circle';
    return 'file';
  }

  protected formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let v = bytes;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) {
      v /= 1024;
      u++;
    }
    const n = new Intl.NumberFormat(this.i18n.currentLocale(), {
      maximumFractionDigits: u === 0 ? 0 : 1,
    }).format(v);
    return `${n} ${units[u]}`;
  }

  private start(file: File): void {
    const id = ++itemSeq;
    const rejection = this.validate(file);
    if (rejection) {
      this.items.update((l) => [
        ...l,
        { id, file, status: 'rejected', progress: 0, ...rejection },
      ]);
      return;
    }
    const backend = (this.backend() ??
      this.injected) as FileUploaderBackend<R> | null;
    if (!backend) {
      this.items.update((l) => [
        ...l,
        {
          id,
          file,
          status: 'error',
          progress: 0,
          errorKey: 'ui.uploader.noBackend',
        },
      ]);
      return;
    }
    this.items.update((l) => [
      ...l,
      { id, file, status: 'uploading', progress: 0 },
    ]);
    const patch = (p: Partial<UploadItem<R>>) =>
      this.items.update((l) =>
        l.map((i) => (i.id === id ? { ...i, ...p } : i)),
      );
    const sub = backend.upload(file).subscribe({
      next: (ev) => {
        if (ev.type === 'progress') {
          patch({
            progress:
              ev.total > 0 ? Math.round((ev.loaded / ev.total) * 100) : 0,
          });
        } else {
          patch({ status: 'done', progress: 100, result: ev.result });
          this.uploaded.emit(ev.result);
        }
      },
      error: (error: unknown) => {
        patch({ status: 'error', errorKey: 'ui.uploader.failed' });
        this.failed.emit({ file, error });
      },
    });
    this.subs.set(id, sub);
  }

  private validate(
    file: File,
  ): Pick<UploadItem, 'errorKey' | 'errorParams'> | null {
    const max = this.maxSizeBytes();
    if (max !== null && file.size > max) {
      return {
        errorKey: 'ui.uploader.tooLarge',
        errorParams: { size: this.formatSize(max) },
      };
    }
    const accept = this.accept();
    if (accept && !matchesAccept(file, accept)) {
      return { errorKey: 'ui.uploader.wrongType' };
    }
    return null;
  }
}

/** `accept` matching as browsers do: extensions, exact MIME, `type/*`. */
export function matchesAccept(
  file: Pick<File, 'name' | 'type'>,
  accept: string,
): boolean {
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  return accept
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => {
      if (rule.startsWith('.')) return name.endsWith(rule);
      if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
      return type === rule;
    });
}
