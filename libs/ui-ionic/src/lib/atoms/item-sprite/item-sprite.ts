import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
} from '@angular/core';
import { spriteGlyph } from '../../organisms/shop-grid/shop-item.js';
import { SPRITE_URL_RESOLVER } from './sprite-url-resolver.js';

/**
 * One item sprite (docs/08 §3): the uploaded image when the API resolved a
 * `spriteUrl`, otherwise the inline token — `emoji:🎩` as a glyph,
 * `color:#hex` as a swatch. A broken image falls back to the token
 * rendering. Decorative: the caller labels the surrounding control. An
 * optional `SPRITE_URL_RESOLVER` may swap the URL for a local copy.
 *
 *   <cdf-item-sprite [token]="item.spriteAssetId" [url]="item.spriteUrl" [size]="48" />
 */
@Component({
  selector: 'cdf-item-sprite',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'cdf-item-sprite',
    'aria-hidden': 'true',
    '[attr.data-rarity]': 'rarity()',
  },
  template: `
    @if (imageUrl(); as src) {
      <img
        class="cdf-item-sprite__img"
        [src]="src"
        alt=""
        [width]="size()"
        [height]="size()"
        loading="lazy"
        decoding="async"
        (error)="failed.set(true)"
      />
    } @else if (glyph().kind === 'emoji') {
      <span class="cdf-item-sprite__glyph" [style.font-size.px]="glyphPx()">{{
        glyph().value
      }}</span>
    } @else {
      <span
        class="cdf-item-sprite__swatch"
        [style.width.px]="size()"
        [style.height.px]="size()"
        [style.background]="glyph().value"
      ></span>
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
      }
      .cdf-item-sprite__img {
        display: block;
        object-fit: contain;
      }
      .cdf-item-sprite__swatch {
        display: block;
        border-radius: var(--cdf-radius-md, 8px);
      }
      /* Rarity glow (docs/08 §3/§6): a filter, never baked into the art. */
      :host([data-rarity='UNCOMMON']) > * {
        filter: drop-shadow(0 0 2px #4ade80);
      }
      :host([data-rarity='RARE']) > * {
        filter: drop-shadow(0 0 3px #60a5fa);
      }
      :host([data-rarity='EPIC']) > * {
        filter: drop-shadow(0 0 4px #f5b301);
      }
      :host([data-rarity='LEGENDARY']) > * {
        filter: drop-shadow(0 0 5px #e879f9);
      }
    `,
  ],
})
export class ItemSprite {
  /** `Item.spriteAssetId`: `emoji:…`, `color:…` or an uploaded Asset id. */
  readonly token = input.required<string>();
  /** API-resolved image URL (`spriteUrl`); null/absent for inline tokens. */
  readonly url = input<string | null | undefined>(null);
  /** Image / swatch edge in px. */
  readonly size = input(40);
  /** Emoji font size in px (defaults to `size`). */
  readonly glyphSize = input<number | null>(null);
  /** Item rarity → glow for UNCOMMON and up; null = plain. */
  readonly rarity = input<string | null | undefined>(null);

  private readonly resolver = inject(SPRITE_URL_RESOLVER, { optional: true });

  /** Reset whenever the URL changes, so a new image gets its own chance. */
  protected readonly failed = linkedSignal({
    source: () => this.url(),
    computation: () => false,
  });
  protected readonly imageUrl = computed(() => {
    const url = this.url();
    if (this.failed() || !url) return null;
    return this.resolver?.resolve(url) ?? url;
  });
  protected readonly glyph = computed(() => spriteGlyph(this.token()));
  protected readonly glyphPx = computed(() => this.glyphSize() ?? this.size());
}
