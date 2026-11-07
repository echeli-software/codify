import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import { Button } from '../../atoms/button/button.js';
import { Icon } from '../../atoms/icon/icon.js';
import {
  clampOffsets,
  cropRect,
  initialCrop,
  minCoverScale,
  zoomTo,
  type CropRect,
  type CropState,
} from './crop-math.js';

export interface CroppedImage {
  blob: Blob;
  width: number;
  height: number;
  /** Source rectangle in natural pixels. */
  rect: CropRect;
}

let cropperSeq = 0;

/**
 * Fixed-aspect image cropper for course covers and item thumbnails. Drag
 * (pointer) or use the arrow keys to pan, the slider / +/- keys to zoom;
 * "Apply" renders the visible region to a canvas and emits a Blob.
 *
 *   <cdf-image-cropper [file]="picked" [aspectRatio]="16 / 9" [outputWidth]="1280"
 *                      (cropped)="upload($event.blob)" />
 */
@Component({
  selector: 'cdf-image-cropper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Icon, TranslatePipe],
  template: `
    <div class="cdf-cropper">
      <div
        #viewport
        class="cdf-cropper__viewport"
        tabindex="0"
        role="group"
        [style.aspect-ratio]="aspectRatio()"
        [attr.aria-label]="'ui.cropper.area' | translate"
        [attr.aria-describedby]="helpId"
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp($event)"
        (pointercancel)="onPointerUp($event)"
        (keydown)="onKeydown($event)"
        (wheel)="onWheel($event)"
      >
        @if (url(); as src) {
          <img
            class="cdf-cropper__img"
            [src]="src"
            alt=""
            draggable="false"
            [style.width.px]="state()?.naturalWidth"
            [style.height.px]="state()?.naturalHeight"
            [style.transform]="transform()"
            (load)="onImageLoad($event)"
          />
        } @else {
          <div class="cdf-cropper__empty">
            <cdf-icon name="image" size="lg" />
            <span>{{ 'ui.cropper.empty' | translate }}</span>
          </div>
        }
        <div class="cdf-cropper__grid" aria-hidden="true"></div>
      </div>
      <p class="cdf-cropper__help" [id]="helpId">
        {{ 'ui.cropper.help' | translate }}
      </p>

      <div class="cdf-cropper__controls">
        <cdf-icon name="zoom-out" size="sm" />
        <input
          type="range"
          class="cdf-cropper__zoom"
          [id]="zoomId"
          [min]="minScale()"
          [max]="maxScale()"
          [step]="(maxScale() - minScale()) / 100 || 0.01"
          [value]="state()?.scale ?? 1"
          [disabled]="!state()"
          [attr.aria-label]="'ui.cropper.zoom' | translate"
          [attr.aria-valuetext]="zoomText()"
          (input)="setZoom(+$any($event.target).value)"
        />
        <cdf-icon name="zoom-in" size="sm" />
        <cdf-button
          kind="ghost"
          size="sm"
          [disabled]="!state()"
          (click)="reset()"
        >
          {{ 'ui.cropper.reset' | translate }}
        </cdf-button>
        <cdf-button
          kind="primary"
          size="sm"
          [disabled]="!state() || busy()"
          (click)="apply()"
        >
          <cdf-icon name="crop" size="sm" />
          {{ 'ui.cropper.apply' | translate }}
        </cdf-button>
      </div>
    </div>
  `,
  styleUrl: './image-cropper.scss',
})
export class ImageCropper {
  /** Image URL (alternative to `file`). */
  readonly src = input<string | null>(null);
  readonly file = input<File | Blob | null>(null);
  /** Width / height, e.g. `16 / 9` or `1`. */
  readonly aspectRatio = input(16 / 9);
  /** Output width in px; height follows the aspect ratio. */
  readonly outputWidth = input(1280);
  readonly outputType = input<'image/jpeg' | 'image/png' | 'image/webp'>(
    'image/jpeg',
  );
  readonly quality = input(0.9);
  /** Max zoom relative to the cover scale. */
  readonly maxZoom = input(6);

  readonly cropped = output<CroppedImage>();
  readonly cropChange = output<CropRect>();

  private readonly viewport =
    viewChild.required<ElementRef<HTMLDivElement>>('viewport');
  protected readonly helpId = `cdf-cropper-help-${++cropperSeq}`;
  protected readonly zoomId = `cdf-cropper-zoom-${cropperSeq}`;
  protected readonly state = signal<CropState | null>(null);
  protected readonly busy = signal(false);
  private readonly objectUrl = signal<string | null>(null);
  private image: HTMLImageElement | null = null;
  private drag: { id: number; x: number; y: number } | null = null;

  protected readonly url = computed(() => this.objectUrl() ?? this.src());
  protected readonly minScale = computed(() => {
    const s = this.state();
    return s ? minCoverScale(s) : 1;
  });
  protected readonly maxScale = computed(
    () => this.minScale() * this.maxZoom(),
  );
  protected readonly zoomText = computed(() => {
    const s = this.state();
    return s ? `${Math.round((s.scale / this.minScale()) * 100)}%` : '';
  });
  protected readonly transform = computed(() => {
    const s = this.state();
    return s
      ? `translate(${s.offsetX}px, ${s.offsetY}px) scale(${s.scale})`
      : null;
  });

  constructor() {
    effect((onCleanup) => {
      const file = this.file();
      if (!file || typeof URL === 'undefined' || !URL.createObjectURL) {
        this.objectUrl.set(null);
        return;
      }
      const u = URL.createObjectURL(file);
      this.objectUrl.set(u);
      onCleanup(() => URL.revokeObjectURL(u));
    });
    effect(() => {
      // New source → forget the old geometry until the image loads.
      this.url();
      this.state.set(null);
    });
    inject(DestroyRef).onDestroy(() => (this.image = null));
  }

  /** Render the current crop (also used by "Apply"). */
  async crop(): Promise<CroppedImage | null> {
    const s = this.state();
    const img = this.image;
    if (!s || !img) return null;
    const rect = cropRect(s);
    const width = Math.round(this.outputWidth());
    const height = Math.round(width / this.aspectRatio());
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, this.outputType(), this.quality()),
    );
    return blob ? { blob, width, height, rect } : null;
  }

  protected async apply(): Promise<void> {
    this.busy.set(true);
    try {
      const out = await this.crop();
      if (out) this.cropped.emit(out);
    } finally {
      this.busy.set(false);
    }
  }

  protected reset(): void {
    const s = this.state();
    if (!s) return;
    this.update(
      initialCrop(
        s.naturalWidth,
        s.naturalHeight,
        s.viewportWidth,
        s.viewportHeight,
      ),
    );
  }

  protected onImageLoad(ev: Event): void {
    const img = ev.target as HTMLImageElement;
    this.image = img;
    const vp = this.viewport().nativeElement.getBoundingClientRect();
    this.update(
      initialCrop(
        img.naturalWidth,
        img.naturalHeight,
        vp.width || 480,
        vp.height || 270,
      ),
    );
  }

  protected setZoom(scale: number): void {
    const s = this.state();
    if (s) this.update(zoomTo(s, scale, this.maxScale()));
  }

  protected onWheel(ev: WheelEvent): void {
    const s = this.state();
    if (!s) return;
    ev.preventDefault();
    this.setZoom(s.scale * (ev.deltaY < 0 ? 1.08 : 1 / 1.08));
  }

  protected onKeydown(ev: KeyboardEvent): void {
    const s = this.state();
    if (!s) return;
    const step = ev.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (moves[ev.key]) {
      ev.preventDefault();
      const [dx, dy] = moves[ev.key];
      this.update(
        clampOffsets({
          ...s,
          offsetX: s.offsetX + dx,
          offsetY: s.offsetY + dy,
        }),
      );
    } else if (ev.key === '+' || ev.key === '=') {
      ev.preventDefault();
      this.setZoom(s.scale * 1.1);
    } else if (ev.key === '-' || ev.key === '_') {
      ev.preventDefault();
      this.setZoom(s.scale / 1.1);
    }
  }

  protected onPointerDown(ev: PointerEvent): void {
    if (!this.state()) return;
    this.drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
  }

  protected onPointerMove(ev: PointerEvent): void {
    const s = this.state();
    if (!s || !this.drag || this.drag.id !== ev.pointerId) return;
    const dx = ev.clientX - this.drag.x;
    const dy = ev.clientY - this.drag.y;
    this.drag = { ...this.drag, x: ev.clientX, y: ev.clientY };
    this.update(
      clampOffsets({ ...s, offsetX: s.offsetX + dx, offsetY: s.offsetY + dy }),
    );
  }

  protected onPointerUp(ev: PointerEvent): void {
    if (this.drag?.id === ev.pointerId) this.drag = null;
  }

  private update(next: CropState): void {
    this.state.set(next);
    this.cropChange.emit(cropRect(next));
  }
}
