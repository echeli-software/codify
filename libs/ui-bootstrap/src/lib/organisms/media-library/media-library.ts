import {
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18nService, TranslatePipe } from '@codify/i18n';
import { isObservable, firstValueFrom } from 'rxjs';
import { Button } from '../../atoms/button/button.js';
import { Icon } from '../../atoms/icon/icon.js';
import { Select, type SelectOption } from '../../atoms/select/select.js';
import { Spinner } from '../../atoms/spinner/spinner.js';
import { FileUploader } from '../../molecules/file-uploader/file-uploader.js';
import type { FileUploaderBackend } from '../../molecules/file-uploader/file-uploader.token.js';
import {
  ASSET_KINDS,
  ASSET_LIBRARY,
  type AssetKind,
  type AssetLibrary,
  type AssetSummary,
} from './asset-library.token.js';

let librarySeq = 0;

/** Basename of the storage key, or the id. */
export function assetDisplayName(a: AssetSummary): string {
  if (a.name) return a.name;
  if (a.key) return a.key.split('/').pop() ?? a.key;
  return a.id;
}

/**
 * Media library: filterable, cursor-paginated grid of uploaded assets with
 * an embedded uploader, backed by the injected `ASSET_LIBRARY`. The grid is
 * a single-select listbox (arrow keys move, Enter / double-click picks).
 *
 *   <cdf-media-library kind="COVER" [(selectedId)]="coverId" (picked)="use($event)" />
 */
@Component({
  selector: 'cdf-media-library',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    Button,
    Icon,
    Select,
    Spinner,
    FileUploader,
    TranslatePipe,
  ],
  template: `
    <section class="cdf-media" [attr.aria-labelledby]="headingId">
      <header class="cdf-media__head">
        <h3 class="cdf-media__title" [id]="headingId">
          {{ 'ui.media.title' | translate }}
        </h3>
        @if (!lockKind()) {
          <cdf-select
            class="cdf-media__filter"
            size="sm"
            [ariaLabel]="'ui.media.filterKind' | translate"
            [options]="kindOptions()"
            [ngModel]="kindFilter()"
            (ngModelChange)="setKind($event)"
          />
        }
      </header>

      @if (allowUpload() && library) {
        <cdf-file-uploader
          class="cdf-media__uploader"
          [accept]="accept()"
          [multiple]="true"
          [maxSizeBytes]="maxSizeBytes()"
          [backend]="uploadBackend"
          (uploaded)="onUploaded($event)"
        />
      }

      @if (!library) {
        <p class="cdf-media__state" role="alert">
          {{ 'ui.media.noBackend' | translate }}
        </p>
      } @else if (error()) {
        <div class="cdf-media__state" role="alert">
          {{ 'ui.media.loadFailed' | translate }}
          <cdf-button kind="secondary" size="sm" (click)="reload()">{{
            'common.retry' | translate
          }}</cdf-button>
        </div>
      } @else if (!loading() && items().length === 0) {
        <p class="cdf-media__state">{{ 'ui.media.empty' | translate }}</p>
      }

      @if (items().length) {
        <ul
          class="cdf-media__grid"
          role="listbox"
          tabindex="0"
          [attr.aria-labelledby]="headingId"
          [attr.aria-activedescendant]="activeId()"
          (keydown)="onKeydown($event)"
        >
          @for (a of items(); track a.id; let i = $index) {
            <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -- keyboard lives on the focusable listbox (aria-activedescendant) -->
            <li
              role="option"
              class="cdf-media__item"
              [id]="optionId(i)"
              [class.cdf-media__item--active]="i === activeIndex()"
              [attr.aria-selected]="a.id === selectedId()"
              (click)="select(a, i)"
              (dblclick)="pick(a)"
            >
              @if (isImage(a)) {
                <img
                  class="cdf-media__thumb"
                  [src]="a.url"
                  alt=""
                  loading="lazy"
                />
              } @else {
                <span class="cdf-media__file">
                  <cdf-icon name="file" size="lg" />
                </span>
              }
              <span class="cdf-media__name">{{ displayName(a) }}</span>
            </li>
          }
        </ul>
      }

      <footer class="cdf-media__foot">
        @if (loading()) {
          <cdf-spinner size="sm" />
        } @else if (nextCursor()) {
          <cdf-button kind="secondary" size="sm" (click)="loadMore()">
            {{ 'ui.media.loadMore' | translate }}
          </cdf-button>
        }
      </footer>
    </section>
  `,
  styleUrl: './media-library.scss',
})
export class MediaLibrary {
  protected readonly library = inject(ASSET_LIBRARY, {
    optional: true,
  }) as AssetLibrary | null;
  private readonly i18n = inject(I18nService);

  /** Restrict to a kind; when set the filter is hidden. */
  readonly kind = input<AssetKind | null>(null);
  readonly allowUpload = input(true);
  readonly accept = input<string | null>('image/*');
  readonly maxSizeBytes = input<number | null>(10 * 1024 * 1024);
  /** Two-way bindable selected asset id. */
  readonly selectedId = model<string | null>(null);

  readonly selectedChange = output<AssetSummary>();
  /** Double-click / Enter — "use this asset". */
  readonly picked = output<AssetSummary>();

  protected readonly headingId = `cdf-media-${++librarySeq}-title`;
  private readonly optionPrefix = `cdf-media-${librarySeq}-opt`;
  protected readonly items = signal<AssetSummary[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly activeIndex = signal(-1);
  protected readonly kindFilter = signal<AssetKind | 'ALL'>('ALL');
  private loadSeq = 0;

  protected readonly lockKind = computed(() => this.kind() !== null);
  protected readonly effectiveKind = computed<AssetKind | null>(() => {
    const k = this.kind();
    if (k) return k;
    const f = this.kindFilter();
    return f === 'ALL' ? null : f;
  });
  protected readonly kindOptions = computed<SelectOption<AssetKind | 'ALL'>[]>(
    () => {
      this.i18n.currentLocale(); // re-label on language switch
      return (['ALL', ...ASSET_KINDS] as const).map((k) => ({
        value: k,
        label: this.i18n.t(`ui.media.kind.${k}`),
      }));
    },
  );
  protected readonly activeId = computed(() =>
    this.activeIndex() >= 0 ? this.optionId(this.activeIndex()) : null,
  );

  /** Uploads go through the library so new assets get the right kind. */
  protected readonly uploadBackend: FileUploaderBackend<AssetSummary> = {
    upload: (file) => {
      if (!this.library) throw new Error('ASSET_LIBRARY not provided');
      return this.library.upload(file, this.effectiveKind());
    },
  };

  constructor() {
    effect(() => {
      const kind = this.effectiveKind();
      untracked(() => void this.load(kind, null, true));
    });
  }

  reload(): void {
    void this.load(this.effectiveKind(), null, true);
  }

  protected optionId(i: number): string {
    return `${this.optionPrefix}-${i}`;
  }

  protected displayName(a: AssetSummary): string {
    return assetDisplayName(a);
  }

  protected isImage(a: AssetSummary): boolean {
    return a.mimeType.startsWith('image/');
  }

  protected setKind(k: AssetKind | 'ALL' | null): void {
    this.kindFilter.set(k ?? 'ALL');
  }

  protected loadMore(): void {
    void this.load(this.effectiveKind(), this.nextCursor(), false);
  }

  protected select(a: AssetSummary, i: number): void {
    this.activeIndex.set(i);
    this.selectedId.set(a.id);
    this.selectedChange.emit(a);
  }

  protected pick(a: AssetSummary): void {
    this.selectedId.set(a.id);
    this.picked.emit(a);
  }

  protected onUploaded(a: AssetSummary): void {
    this.items.update((list) => [a, ...list.filter((x) => x.id !== a.id)]);
    this.select(a, 0);
  }

  protected onKeydown(ev: KeyboardEvent): void {
    const count = this.items().length;
    if (!count) return;
    const cols = this.columns(ev.currentTarget as HTMLElement);
    const i = Math.max(0, this.activeIndex());
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: cols,
      ArrowUp: -cols,
    };
    if (ev.key in moves) {
      ev.preventDefault();
      const next = Math.min(
        count - 1,
        Math.max(0, this.activeIndex() < 0 ? 0 : i + moves[ev.key]),
      );
      this.select(this.items()[next], next);
    } else if (ev.key === 'Home' || ev.key === 'End') {
      ev.preventDefault();
      const next = ev.key === 'Home' ? 0 : count - 1;
      this.select(this.items()[next], next);
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      const a = this.items()[i];
      if (a) this.pick(a);
    }
  }

  private columns(grid: HTMLElement): number {
    const first = grid.querySelector('li');
    if (!first) return 1;
    const w = first.getBoundingClientRect().width;
    return w > 0 ? Math.max(1, Math.round(grid.clientWidth / w)) : 1;
  }

  private async load(
    kind: AssetKind | null,
    cursor: string | null,
    replace: boolean,
  ): Promise<void> {
    if (!this.library) return;
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(false);
    try {
      const res = this.library.list(kind, cursor);
      const page = isObservable(res) ? await firstValueFrom(res) : await res;
      if (seq !== this.loadSeq) return;
      this.items.update((list) =>
        replace ? page.items : [...list, ...page.items],
      );
      this.nextCursor.set(page.nextCursor);
      if (replace) this.activeIndex.set(-1);
    } catch {
      if (seq === this.loadSeq) this.error.set(true);
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }
}
