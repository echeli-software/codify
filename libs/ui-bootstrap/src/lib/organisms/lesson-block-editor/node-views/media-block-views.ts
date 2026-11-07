import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  EMBED_PROVIDER_LABELS,
  isAllowedImageSrc,
  parseEmbedUrl,
  type EmbedProvider,
} from '@codify/lesson-schema';
import { EditorIcon } from '../../block-toolbar/editor-icon.js';
import type { LessonNodeViewComponent } from '../tiptap/angular-node-view.js';

let nextId = 0;

/** Editor node view for images: preview + alt (required), caption, width. */
@Component({
  selector: 'cdf-image-block-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EditorIcon],
  template: `
    <figure class="cdf-nv cdf-nv--image" [attr.data-width]="attrs()['width']">
      @if (safeSrc(); as src) {
        <img class="cdf-nv__img" [src]="src" [alt]="alt()" loading="lazy" />
      } @else {
        <p class="cdf-nv__issues" role="status">Image source is not allowed.</p>
      }
      <div class="cdf-nv__row">
        <label class="cdf-nv__field cdf-nv__grow">
          <span class="cdf-nv__label">Alt text (required)</span>
          <input
            type="text"
            [value]="alt()"
            [readOnly]="!editable()"
            [attr.aria-invalid]="!alt().trim() || null"
            [attr.aria-describedby]="!alt().trim() ? uid + '-alt-err' : null"
            placeholder="Describe the image for screen readers"
            (input)="patch('alt', $event)"
          />
        </label>
        <label class="cdf-nv__field">
          <span class="cdf-nv__label">Width</span>
          <select
            [value]="attrs()['width'] ?? 'full'"
            [disabled]="!editable()"
            (change)="patch('width', $event)"
          >
            <option value="full">Full</option>
            <option value="wide">Wide</option>
            <option value="inline">Inline</option>
          </select>
        </label>
        @if (editable()) {
          <button
            type="button"
            class="cdf-nv__icon-btn"
            aria-label="Delete image"
            title="Delete image"
            (click)="remove.emit()"
          >
            <cdf-editor-icon name="Trash" size="16" />
          </button>
        }
      </div>
      @if (!alt().trim()) {
        <p class="cdf-nv__issues" role="status" [id]="uid + '-alt-err'">
          <cdf-editor-icon name="WarningCircle" size="14" /> Images need alt
          text before the lesson can be saved.
        </p>
      }
      <label class="cdf-nv__field">
        <span class="cdf-nv__label">Caption</span>
        <input
          type="text"
          [value]="attrs()['caption'] ?? ''"
          [readOnly]="!editable()"
          (input)="patch('caption', $event)"
        />
      </label>
    </figure>
  `,
  styleUrl: './node-views.scss',
})
export class ImageBlockView implements LessonNodeViewComponent {
  readonly attrs = input<Record<string, unknown>>({});
  readonly editable = input(true);
  readonly attrsChange = output<Record<string, unknown>>();
  readonly remove = output<void>();

  protected readonly uid = `cdf-image-view-${nextId++}`;
  protected readonly alt = computed(() => String(this.attrs()['alt'] ?? ''));
  protected readonly safeSrc = computed(() => {
    const src = this.attrs()['src'];
    return isAllowedImageSrc(src) ? src : null;
  });

  protected patch(key: 'alt' | 'caption' | 'width', event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    this.attrsChange.emit({
      [key]: key === 'caption' && !value.trim() ? null : value,
    });
  }
}

/** Editor node view for embeds: provider card + title / URL fields. */
@Component({
  selector: 'cdf-embed-block-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EditorIcon],
  template: `
    <section
      class="cdf-nv cdf-nv--embed"
      [attr.aria-labelledby]="uid + '-title'"
    >
      <header class="cdf-nv__header">
        <span class="cdf-nv__badge"
          ><cdf-editor-icon name="FrameCorners" size="16"
        /></span>
        <h4 class="cdf-nv__title" [id]="uid + '-title'">
          {{ providerLabel() }} embed
        </h4>
        @if (editable()) {
          <button
            type="button"
            class="cdf-nv__icon-btn"
            aria-label="Delete embed"
            title="Delete embed"
            (click)="remove.emit()"
          >
            <cdf-editor-icon name="Trash" size="16" />
          </button>
        }
      </header>
      <label class="cdf-nv__field">
        <span class="cdf-nv__label">Title (read by screen readers)</span>
        <input
          type="text"
          [value]="attrs()['title'] ?? ''"
          [readOnly]="!editable()"
          (input)="setTitle($event)"
        />
      </label>
      <label class="cdf-nv__field">
        <span class="cdf-nv__label">URL</span>
        <input
          type="url"
          [value]="attrs()['url'] ?? ''"
          [readOnly]="!editable()"
          [attr.aria-invalid]="!valid() || null"
          (input)="setUrl($event)"
        />
      </label>
      @if (!valid()) {
        <p class="cdf-nv__issues" role="status">
          <cdf-editor-icon name="WarningCircle" size="14" />
          Use a YouTube, Vimeo, CodePen, CodeSandbox or Loom link.
        </p>
      } @else {
        <p class="cdf-nv__hint">
          Students see the {{ providerLabel() }} player here (sandboxed).
        </p>
      }
    </section>
  `,
  styleUrl: './node-views.scss',
})
export class EmbedBlockView implements LessonNodeViewComponent {
  readonly attrs = input<Record<string, unknown>>({});
  readonly editable = input(true);
  readonly attrsChange = output<Record<string, unknown>>();
  readonly remove = output<void>();

  protected readonly uid = `cdf-embed-view-${nextId++}`;
  protected readonly valid = computed(() => {
    const parsed = parseEmbedUrl(this.attrs()['url']);
    return !!parsed && parsed.provider === this.attrs()['provider'];
  });
  protected readonly providerLabel = computed(
    () =>
      EMBED_PROVIDER_LABELS[this.attrs()['provider'] as EmbedProvider] ??
      'Unknown',
  );

  protected setTitle(event: Event): void {
    this.attrsChange.emit({ title: (event.target as HTMLInputElement).value });
  }

  protected setUrl(event: Event): void {
    const url = (event.target as HTMLInputElement).value.trim();
    const parsed = parseEmbedUrl(url);
    this.attrsChange.emit(
      parsed ? { url, provider: parsed.provider } : { url },
    );
  }
}
