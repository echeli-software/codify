import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';

export type AvatarSlot =
  | 'PET'
  | 'BACKGROUND'
  | 'TOP'
  | 'BOTTOM'
  | 'SHOES'
  | 'HAT'
  | 'HAIR'
  | 'GLASSES'
  | 'ACCESSORY'
  | 'FRAME'
  | 'EMOTE';

export interface AvatarSprite {
  /** Placeholder token ("emoji:🧢" / "color:#88ccff") or an uploaded Asset id. */
  spriteAssetId: string;
  /** Resolved image URL for an uploaded sprite (API `spriteUrl`). */
  spriteUrl?: string | null;
  name?: string;
  rarity?: string;
}

export interface AvatarConfigLike {
  skinTone?: string;
  baseHairColor?: string;
}

type SpriteKind = 'emoji' | 'color' | 'image';

interface Layer {
  slot: AvatarSlot;
  kind: SpriteKind;
  value: string;
  style: Record<string, string>;
}

const SKIN_EMOJI: Record<string, string> = {
  porcelain: '🧑🏻',
  fair: '🧑🏻',
  light: '🧑🏼',
  tan: '🧑🏽',
  olive: '🧑🏽',
  brown: '🧑🏾',
  dark: '🧑🏿',
  deep: '🧑🏿',
};

/**
 * Composites a 2D avatar from a base config + equipped item sprites, stacked
 * in the documented slot/layer order (docs/08-avatar-and-shop.md §2).
 * Uploaded sprites (an API-resolved `spriteUrl`) render as images; inline
 * tokens ("emoji:🧢" / "color:#hex") as positioned glyphs/shapes. An image
 * that fails to load falls back to the token rendering.
 */
@Component({
  selector: 'cdf-avatar-renderer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <div
      class="avatar"
      [style.width.px]="size()"
      [style.height.px]="size()"
      [style.background]="backgroundStyle()"
      [class.avatar--ring]="showLevelRing() || !!frameLayer()"
      [style.--ring-color]="ringColor()"
      [attr.role]="'img'"
      [attr.aria-label]="
        itemNames().length
          ? ('ui.avatar.wearing' | translate: { items: itemNames().join(', ') })
          : ('ui.avatar.label' | translate)
      "
    >
      <span class="avatar__base" [style.font-size.px]="size() * 0.6">{{
        baseEmoji()
      }}</span>

      @for (layer of layers(); track layer.slot) {
        @if (layer.kind === 'image') {
          <img
            class="avatar__layer avatar__layer--img"
            [style]="layer.style"
            [src]="layer.value"
            alt=""
            decoding="async"
            (error)="markFailed(layer.value)"
          />
        } @else if (layer.kind === 'emoji') {
          <span class="avatar__layer" [style]="layer.style">{{
            layer.value
          }}</span>
        } @else {
          <span
            class="avatar__layer avatar__layer--color"
            [style]="layer.style"
            [style.background]="layer.value"
          ></span>
        }
      }

      @if (petLayer(); as pet) {
        @if (pet.kind === 'image') {
          <img
            class="avatar__pet avatar__pet--img"
            [src]="pet.value"
            alt=""
            [style.width.px]="size() * 0.32"
            [style.height.px]="size() * 0.32"
            decoding="async"
            (error)="markFailed(pet.value)"
          />
        } @else {
          <span class="avatar__pet" [style.font-size.px]="size() * 0.28">{{
            pet.value
          }}</span>
        }
      }

      @if (frameImage(); as frame) {
        <img
          class="avatar__frame"
          [src]="frame"
          alt=""
          decoding="async"
          (error)="markFailed(frame)"
        />
      }

      @if (showLevelRing() && level() !== null) {
        <span class="avatar__level">{{ level() }}</span>
      }
    </div>
  `,
  styles: [
    `
      .avatar {
        position: relative;
        border-radius: 18px;
        overflow: visible;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--cdf-color-surface-2, #eef1f6);
      }
      .avatar--ring {
        box-shadow: 0 0 0 3px
          var(--ring-color, var(--cdf-color-primary, #5b8def));
      }
      .avatar__base,
      .avatar__layer {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        line-height: 1;
        pointer-events: none;
      }
      .avatar__base {
        top: 50%;
        transform: translate(-50%, -50%);
      }
      .avatar__layer--color {
        border-radius: 6px;
      }
      .avatar__layer--img,
      .avatar__pet--img,
      .avatar__frame {
        object-fit: contain;
      }
      .avatar__frame {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }
      .avatar__pet {
        position: absolute;
        right: -6%;
        bottom: 2%;
        line-height: 1;
      }
      .avatar__level {
        position: absolute;
        bottom: -8px;
        right: -8px;
        background: var(--ring-color, var(--cdf-color-primary, #5b8def));
        color: var(--cdf-color-ink, #111827);
        font-size: 11px;
        font-weight: 700;
        min-width: 20px;
        height: 20px;
        padding: 0 5px;
        border-radius: 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 2px solid var(--cdf-color-surface, #fff);
      }
    `,
  ],
})
export class AvatarRenderer {
  readonly config = input<AvatarConfigLike | null>(null);
  readonly equipped = input<Partial<Record<AvatarSlot, AvatarSprite>>>({});
  readonly size = input<number>(160);
  readonly level = input<number | null>(null);
  readonly showLevelRing = input<boolean>(false);

  /** Image URLs that failed to load → render their token instead. */
  private readonly failedUrls = signal<ReadonlySet<string>>(new Set());

  protected markFailed(url: string): void {
    if (this.failedUrls().has(url)) return;
    this.failedUrls.update((s) => new Set(s).add(url));
  }

  /** Image when resolved + loadable, else the token. */
  private sprite(s: AvatarSprite): { kind: SpriteKind; value: string } {
    const url = s.spriteUrl;
    if (url && !this.failedUrls().has(url))
      return { kind: 'image', value: url };
    return parseSprite(s.spriteAssetId);
  }

  protected readonly baseEmoji = computed(() => {
    const tone = this.config()?.skinTone;
    return (tone && SKIN_EMOJI[tone]) || '🧑';
  });

  protected readonly backgroundStyle = computed(() => {
    const bg = this.equipped()['BACKGROUND'];
    if (!bg) return '';
    const p = this.sprite(bg);
    if (p.kind === 'image')
      return `center / cover no-repeat url("${cssUrl(p.value)}")`;
    return p.kind === 'color' ? p.value : '';
  });

  protected readonly frameLayer = computed(
    () => this.equipped()['FRAME'] ?? null,
  );

  protected readonly ringColor = computed(() => {
    const frame = this.frameLayer();
    if (frame) {
      const p = this.sprite(frame);
      if (p.kind === 'color') return p.value;
    }
    return 'var(--cdf-color-primary, #5b8def)';
  });

  /** Uploaded frame art, drawn over the whole canvas. */
  protected readonly frameImage = computed(() => {
    const frame = this.frameLayer();
    if (!frame) return null;
    const p = this.sprite(frame);
    return p.kind === 'image' ? p.value : null;
  });

  protected readonly petLayer = computed<{
    kind: 'emoji' | 'image';
    value: string;
  } | null>(() => {
    const pet = this.equipped()['PET'];
    if (!pet) return null;
    const p = this.sprite(pet);
    if (p.kind === 'image') return { kind: 'image', value: p.value };
    return { kind: 'emoji', value: p.kind === 'emoji' ? p.value : '🐾' };
  });

  protected readonly itemNames = computed(() =>
    Object.values(this.equipped())
      .map((s) => s?.name)
      .filter((n): n is string => !!n),
  );

  /** Stackable layers (excludes BACKGROUND/PET/FRAME which render specially). */
  protected readonly layers = computed<Layer[]>(() => {
    const eq = this.equipped();
    const sz = this.size();
    const out: Layer[] = [];
    // Bottom → top stacking order; BACKGROUND, PET, FRAME handled separately.
    for (const slot of STACK_ORDER) {
      const sprite = eq[slot];
      if (!sprite) continue;
      const p = this.sprite(sprite);
      const pos = SLOT_POS[slot];
      const fontPx = sz * pos.scale;
      const style: Record<string, string> =
        p.kind === 'emoji'
          ? { top: `${pos.top}%`, 'font-size': `${fontPx}px` }
          : { top: `${pos.top}%`, width: `${fontPx}px`, height: `${fontPx}px` };
      out.push({ slot, kind: p.kind, value: p.value, style });
    }
    return out;
  });
}

/** Bottom-to-top draw order for stacked slots. */
const STACK_ORDER: AvatarSlot[] = [
  'SHOES',
  'BOTTOM',
  'TOP',
  'ACCESSORY',
  'HAIR',
  'GLASSES',
  'HAT',
  'EMOTE',
];

/** Approximate anchor (% from top) + glyph scale per slot on the canvas. */
const SLOT_POS: Record<AvatarSlot, { top: number; scale: number }> = {
  BACKGROUND: { top: 0, scale: 1 },
  SHOES: { top: 78, scale: 0.22 },
  BOTTOM: { top: 60, scale: 0.28 },
  TOP: { top: 44, scale: 0.34 },
  ACCESSORY: { top: 40, scale: 0.26 },
  HAIR: { top: 8, scale: 0.4 },
  GLASSES: { top: 30, scale: 0.26 },
  HAT: { top: 0, scale: 0.4 },
  EMOTE: { top: 4, scale: 0.3 },
  FRAME: { top: 0, scale: 1 },
  PET: { top: 70, scale: 0.28 },
};

/** Escape a URL for a double-quoted CSS `url("…")`. */
function cssUrl(url: string): string {
  return url.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c));
}

function parseSprite(token: string): {
  kind: 'emoji' | 'color';
  value: string;
} {
  if (token.startsWith('emoji:'))
    return { kind: 'emoji', value: token.slice(6) };
  if (token.startsWith('color:'))
    return { kind: 'color', value: token.slice(6) };
  // Unknown token → render a neutral block.
  return { kind: 'color', value: 'rgba(0,0,0,0.1)' };
}
