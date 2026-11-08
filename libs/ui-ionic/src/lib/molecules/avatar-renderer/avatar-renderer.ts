import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import {
  normalizeAvatarConfig,
  SKIN_TONE_HEX,
  type AvatarPose,
} from '@codify/ui-core';
import { SPRITE_URL_RESOLVER } from '../../atoms/item-sprite/sprite-url-resolver.js';

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

/** AvatarConfig as stored (docs/08 §5); every field optional / tolerant. */
export interface AvatarConfigLike {
  baseBodyId?: string;
  skinTone?: string;
  baseHairStyle?: string;
  baseHairColor?: string;
  eyeColor?: string;
  pose?: string;
}

type SpriteKind = 'emoji' | 'color' | 'image';

/** One item drawn on the canvas. */
export interface AvatarLayer {
  slot: AvatarSlot;
  kind: SpriteKind;
  value: string;
  /** Anchor box (canvas units, 256×256). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** SVG filter id for the rarity glow, or null. */
  glow: string | null;
}

/** Torso half-widths per base body (vector, no external art). */
const BODY_HALF: Record<string, number> = { classic: 48, broad: 58, slim: 38 };

/** Anchor boxes per slot on the 256×256 canvas (docs/08 §3). */
const ANCHORS: Record<
  AvatarSlot,
  { x: number; y: number; w: number; h: number }
> = {
  BACKGROUND: { x: 0, y: 0, w: 256, h: 256 },
  SHOES: { x: 88, y: 222, w: 80, h: 34 },
  BOTTOM: { x: 90, y: 196, w: 76, h: 48 },
  TOP: { x: 80, y: 140, w: 96, h: 76 },
  ACCESSORY: { x: 104, y: 140, w: 48, h: 44 },
  HAIR: { x: 72, y: 30, w: 112, h: 92 },
  GLASSES: { x: 92, y: 74, w: 72, h: 36 },
  HAT: { x: 80, y: 8, w: 96, h: 66 },
  EMOTE: { x: 182, y: 24, w: 52, h: 52 },
  FRAME: { x: 0, y: 0, w: 256, h: 256 },
  PET: { x: 186, y: 182, w: 66, h: 66 },
};

/** Item slots stacked over the body, bottom → top (docs/08 §2). */
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

/** Glow colours per rarity (docs/08 §3: a filter, not baked into assets). */
export const RARITY_GLOW: Record<string, string> = {
  UNCOMMON: '#4ade80',
  RARE: '#60a5fa',
  EPIC: '#f5b301',
  LEGENDARY: '#e879f9',
};

const DEFAULT_TOP = '#9aa4b2';
const DEFAULT_BOTTOM = '#4b5563';
const DEFAULT_SHOES = '#1f2937';

let rendererSeq = 0;

/**
 * The avatar as one SVG composite (docs/08 §4): background, a vector base
 * body (base body, skin tone, base hair style + colour, eye colour) posed
 * idle / wave / cheer / study, item layers in the documented stack order
 * (docs/08 §2), the pet beside the avatar and the frame on top. Items
 * render as their uploaded image when the API resolved a `spriteUrl`,
 * else as their inline token — `emoji:` glyphs, and `color:` tokens that
 * tint the matching vector part (shirt, trousers, shoes, cap, frames…).
 * A broken image falls back to the token. RARE+ items get a rarity glow
 * filter. `animate` adds a tiny idle "breathing" loop, off for
 * `prefers-reduced-motion`. With `interactive` the avatar is a button that
 * emits `avatarClick` (tap-to-customize).
 */
@Component({
  selector: 'cdf-avatar-renderer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <div
      class="avatar"
      [class.avatar--ring]="showLevelRing() || ringFromFrame()"
      [class.avatar--interactive]="interactive()"
      [class.avatar--animate]="animate()"
      [attr.data-pose]="poseName()"
      [style.width.px]="size()"
      [style.height.px]="size()"
      [style.--ring-color]="ringColor()"
      [attr.role]="interactive() ? 'button' : 'img'"
      [attr.tabindex]="interactive() ? 0 : null"
      [attr.aria-label]="
        interactive()
          ? ('ui.avatar.customize' | translate)
          : itemNames().length
            ? ('ui.avatar.wearing'
              | translate: { items: itemNames().join(', ') })
            : ('ui.avatar.label' | translate)
      "
      (click)="onClick()"
      (keydown.enter)="onClick()"
      (keydown.space)="onKeySpace($event)"
    >
      <svg
        class="avatar__svg"
        viewBox="0 0 256 256"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          @for (g of glowDefs(); track g.id) {
            <filter
              [attr.id]="g.id"
              x="-30%"
              y="-30%"
              width="160%"
              height="160%"
            >
              <feDropShadow
                dx="0"
                dy="0"
                [attr.stdDeviation]="g.blur"
                [attr.flood-color]="g.color"
                flood-opacity="0.95"
              />
            </filter>
          }
          <clipPath [attr.id]="clipId">
            <rect x="0" y="0" width="256" height="256" rx="28" />
          </clipPath>
        </defs>

        <g [attr.clip-path]="'url(#' + clipId + ')'">
          <!-- Background -->
          <rect
            class="avatar__bg"
            x="0"
            y="0"
            width="256"
            height="256"
            [style.fill]="bgFill()"
          />
          @if (background(); as bg) {
            @if (bg.kind === 'image') {
              <image
                [attr.href]="bg.value"
                x="0"
                y="0"
                width="256"
                height="256"
                preserveAspectRatio="xMidYMid slice"
                (error)="markFailed(bg.value)"
              />
            } @else if (bg.kind === 'emoji') {
              <text
                class="avatar__glyph avatar__bg-glyph"
                x="128"
                y="132"
                font-size="190"
              >
                {{ bg.value }}
              </text>
            }
          }

          <g class="avatar__figure" [attr.data-body]="look().baseBodyId">
            <!-- Hair drawn behind the head (long / coily / covered) -->
            @if (!hairItem()) {
              @switch (look().baseHairStyle) {
                @case ('long') {
                  <path
                    class="avatar__hair"
                    data-part="hair-back"
                    d="M78 96 Q76 40 128 40 Q180 40 178 96 L184 168 Q128 182 72 168 Z"
                    [attr.fill]="look().baseHairColor"
                  />
                }
                @case ('coily') {
                  <circle
                    class="avatar__hair"
                    data-part="hair-back"
                    cx="128"
                    cy="80"
                    r="60"
                    [attr.fill]="look().baseHairColor"
                  />
                }
                @case ('covered') {
                  <path
                    class="avatar__hair"
                    data-part="hair-back"
                    d="M74 104 Q72 34 128 34 Q184 34 182 104 L180 146 Q128 166 76 146 Z"
                    [attr.fill]="look().baseHairColor"
                  />
                }
              }
            }

            <!-- Legs / bottom / shoes -->
            <rect
              data-part="bottom"
              [attr.x]="128 - half() + 12"
              y="206"
              [attr.width]="(half() - 12) * 2"
              height="34"
              rx="8"
              [attr.fill]="tint('BOTTOM', defaultBottom)"
            />
            <ellipse
              data-part="shoe"
              [attr.cx]="128 - half() / 2"
              cy="243"
              rx="20"
              ry="9"
              [attr.fill]="tint('SHOES', defaultShoes)"
            />
            <ellipse
              data-part="shoe"
              [attr.cx]="128 + half() / 2"
              cy="243"
              rx="20"
              ry="9"
              [attr.fill]="tint('SHOES', defaultShoes)"
            />

            <!-- Arms (behind the torso when down) -->
            @for (arm of arms(); track $index) {
              <line
                class="avatar__arm"
                [attr.x1]="arm.x1"
                [attr.y1]="arm.y1"
                [attr.x2]="arm.x2"
                [attr.y2]="arm.y2"
                [attr.stroke]="tint('TOP', defaultTop)"
                stroke-width="16"
                stroke-linecap="round"
              />
              <circle
                [attr.cx]="arm.x2"
                [attr.cy]="arm.y2"
                r="8"
                [attr.fill]="skin()"
              />
            }

            <!-- Neck + torso (base top) -->
            <rect x="117" y="126" width="22" height="24" [attr.fill]="skin()" />
            <path
              class="avatar__torso"
              data-part="torso"
              [attr.d]="torsoPath()"
              [attr.fill]="tint('TOP', defaultTop)"
            />

            @if (poseName() === 'study') {
              <g data-part="book">
                <rect
                  x="100"
                  y="170"
                  width="56"
                  height="38"
                  rx="4"
                  fill="#5b8def"
                />
                <line
                  x1="128"
                  y1="170"
                  x2="128"
                  y2="208"
                  stroke="#ffffff"
                  stroke-width="2"
                />
              </g>
            }

            <!-- Head -->
            <circle cx="84" cy="94" r="9" [attr.fill]="skin()" />
            <circle cx="172" cy="94" r="9" [attr.fill]="skin()" />
            <circle
              class="avatar__head"
              data-part="head"
              cx="128"
              cy="90"
              r="44"
              [attr.fill]="skin()"
            />

            <!-- Eyes -->
            @for (ex of eyeXs; track ex) {
              <ellipse
                [attr.cx]="ex"
                cy="90"
                rx="7.5"
                ry="8.5"
                fill="#ffffff"
              />
              <circle
                data-part="iris"
                [attr.cx]="ex"
                cy="91"
                r="4.8"
                [attr.fill]="look().eyeColor"
              />
              <circle [attr.cx]="ex" cy="91" r="2" fill="#111827" />
            }
            <!-- Mouth -->
            @if (poseName() === 'cheer') {
              <path
                data-part="mouth"
                d="M112 108 Q128 128 144 108 Z"
                fill="#7f1d1d"
              />
            } @else {
              <path
                data-part="mouth"
                d="M114 110 Q128 120 142 110"
                fill="none"
                stroke="#7f1d1d"
                stroke-width="3"
                stroke-linecap="round"
              />
            }

            <!-- Base hair over the head -->
            @if (!hairItem()) {
              @switch (look().baseHairStyle) {
                @case ('short') {
                  <path
                    class="avatar__hair"
                    data-part="hair"
                    d="M84 86 Q82 44 128 44 Q174 44 172 86 Q160 62 128 62 Q96 62 84 86 Z"
                    [attr.fill]="look().baseHairColor"
                  />
                }
                @case ('medium') {
                  <path
                    class="avatar__hair"
                    data-part="hair"
                    d="M80 112 Q74 42 128 42 Q182 42 176 112 L166 112 Q168 66 128 64 Q88 66 90 112 Z"
                    [attr.fill]="look().baseHairColor"
                  />
                }
                @case ('long') {
                  <path
                    class="avatar__hair"
                    data-part="hair"
                    d="M82 96 Q80 42 128 42 Q176 42 174 96 Q162 60 128 60 Q94 60 82 96 Z"
                    [attr.fill]="look().baseHairColor"
                  />
                }
                @case ('curly') {
                  <g data-part="hair" [attr.fill]="look().baseHairColor">
                    @for (c of curls; track $index) {
                      <circle
                        [attr.cx]="c[0]"
                        [attr.cy]="c[1]"
                        [attr.r]="c[2]"
                      />
                    }
                  </g>
                }
                @case ('coily') {
                  <path
                    class="avatar__hair"
                    data-part="hair"
                    d="M80 80 Q84 40 128 38 Q172 40 176 80 Q160 58 128 58 Q96 58 80 80 Z"
                    [attr.fill]="look().baseHairColor"
                  />
                }
                @case ('covered') {
                  <path
                    class="avatar__hair"
                    data-part="hair"
                    d="M82 84 Q84 40 128 40 Q172 40 174 84 Q128 64 82 84 Z"
                    [attr.fill]="look().baseHairColor"
                  />
                }
              }
            }

            <!-- Item layers, bottom → top -->
            @for (layer of layers(); track layer.slot) {
              <g
                class="avatar__layer"
                [attr.data-slot]="layer.slot"
                [attr.filter]="layer.glow ? 'url(#' + layer.glow + ')' : null"
              >
                @if (layer.kind === 'image') {
                  <image
                    [attr.href]="layer.value"
                    [attr.x]="layer.x"
                    [attr.y]="layer.y"
                    [attr.width]="layer.w"
                    [attr.height]="layer.h"
                    preserveAspectRatio="xMidYMid meet"
                    (error)="markFailed(layer.value)"
                  />
                } @else if (layer.kind === 'emoji') {
                  <text
                    class="avatar__glyph"
                    [attr.x]="layer.x + layer.w / 2"
                    [attr.y]="layer.y + layer.h / 2 + 2"
                    [attr.font-size]="layer.h * 0.9"
                  >
                    {{ layer.value }}
                  </text>
                } @else {
                  @switch (layer.slot) {
                    @case ('HAT') {
                      <path
                        d="M84 70 Q84 30 128 30 Q172 30 172 70 Z M78 66 h100 v8 h-100 Z"
                        [attr.fill]="layer.value"
                      />
                    }
                    @case ('GLASSES') {
                      <g
                        fill="none"
                        [attr.stroke]="layer.value"
                        stroke-width="4"
                      >
                        <circle cx="112" cy="90" r="12" />
                        <circle cx="144" cy="90" r="12" />
                        <line x1="124" y1="90" x2="132" y2="90" />
                      </g>
                    }
                    @case ('HAIR') {
                      <path
                        d="M80 104 Q74 40 128 40 Q182 40 176 104 Q164 60 128 60 Q92 60 80 104 Z"
                        [attr.fill]="layer.value"
                      />
                    }
                    @case ('ACCESSORY') {
                      <path
                        d="M106 146 Q128 176 150 146"
                        fill="none"
                        [attr.stroke]="layer.value"
                        stroke-width="5"
                        stroke-linecap="round"
                      />
                    }
                    @case ('EMOTE') {
                      <circle
                        [attr.cx]="layer.x + layer.w / 2"
                        [attr.cy]="layer.y + layer.h / 2"
                        [attr.r]="layer.w / 2.4"
                        [attr.fill]="layer.value"
                      />
                    }
                    @default {
                      <!-- TOP / BOTTOM / SHOES tint the vector parts. -->
                    }
                  }
                }
              </g>
            }
          </g>

          <!-- Pet, beside the avatar (docs/08 §10) -->
          @if (pet(); as p) {
            <g
              class="avatar__pet"
              data-slot="PET"
              [attr.filter]="p.glow ? 'url(#' + p.glow + ')' : null"
            >
              @if (p.kind === 'image') {
                <image
                  [attr.href]="p.value"
                  [attr.x]="p.x"
                  [attr.y]="p.y"
                  [attr.width]="p.w"
                  [attr.height]="p.h"
                  preserveAspectRatio="xMidYMid meet"
                  (error)="markFailed(p.value)"
                />
              } @else {
                <text
                  class="avatar__glyph"
                  [attr.x]="p.x + p.w / 2"
                  [attr.y]="p.y + p.h / 2 + 2"
                  [attr.font-size]="p.h * 0.85"
                >
                  {{ p.kind === 'emoji' ? p.value : '🐾' }}
                </text>
              }
            </g>
          }
        </g>

        <!-- Frame on top -->
        @if (frame(); as f) {
          @if (f.kind === 'image') {
            <image
              [attr.href]="f.value"
              x="0"
              y="0"
              width="256"
              height="256"
              preserveAspectRatio="xMidYMid meet"
              (error)="markFailed(f.value)"
            />
          } @else if (f.kind === 'emoji') {
            <text class="avatar__glyph" x="34" y="36" font-size="44">
              {{ f.value }}
            </text>
          }
        }
      </svg>

      @if (showLevelRing() && level() !== null) {
        <span class="avatar__level">{{ level() }}</span>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-block;
        line-height: 0;
      }
      .avatar {
        position: relative;
        border-radius: 18px;
        display: inline-block;
        background: var(--cdf-color-surface-2, #eef1f6);
      }
      .avatar--ring {
        box-shadow: 0 0 0 3px
          var(--ring-color, var(--cdf-color-primary, #5b8def));
      }
      .avatar--interactive {
        cursor: pointer;
      }
      .avatar--interactive:focus-visible {
        outline: 3px solid var(--cdf-color-primary, #5b8def);
        outline-offset: 3px;
      }
      .avatar__svg {
        display: block;
        width: 100%;
        height: 100%;
        overflow: visible;
      }
      .avatar__glyph {
        text-anchor: middle;
        dominant-baseline: central;
        pointer-events: none;
      }
      .avatar__bg-glyph {
        opacity: 0.35;
      }
      .avatar__figure {
        transform-origin: 128px 250px;
        transform-box: view-box;
      }
      .avatar--animate .avatar__figure {
        animation: cdf-avatar-breathe 3.2s ease-in-out infinite;
      }
      .avatar--animate[data-pose='cheer'] .avatar__figure {
        animation: cdf-avatar-cheer 0.9s ease-in-out infinite;
      }
      @keyframes cdf-avatar-breathe {
        0%,
        100% {
          transform: scale(1, 1);
        }
        50% {
          transform: scale(1.01, 1.025);
        }
      }
      @keyframes cdf-avatar-cheer {
        0%,
        100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-6px);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .avatar--animate .avatar__figure,
        .avatar--animate[data-pose='cheer'] .avatar__figure {
          animation: none;
        }
      }
      .avatar__level {
        position: absolute;
        bottom: -8px;
        right: -8px;
        background: var(--ring-color, var(--cdf-color-primary, #5b8def));
        color: var(--cdf-color-ink, #111827);
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
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
  /** Overrides `config.pose` (e.g. `cheer` while celebrating). */
  readonly pose = input<AvatarPose | null>(null);
  /** Idle breathing / cheer bounce (never with prefers-reduced-motion). */
  readonly animate = input<boolean>(false);
  /** Render as a button that emits `avatarClick` (tap-to-customize). */
  readonly interactive = input<boolean>(false);

  readonly avatarClick = output<void>();

  private readonly resolver = inject(SPRITE_URL_RESOLVER, { optional: true });
  private readonly uid = `cdf-av-${++rendererSeq}`;
  protected readonly clipId = `${this.uid}-clip`;
  protected readonly eyeXs = [112, 144];
  protected readonly defaultTop = DEFAULT_TOP;
  protected readonly defaultBottom = DEFAULT_BOTTOM;
  protected readonly defaultShoes = DEFAULT_SHOES;
  /** Curly hair as a ring of curls around the top of the head. */
  protected readonly curls: [number, number, number][] = [
    [88, 82, 14],
    [96, 62, 15],
    [114, 50, 16],
    [134, 48, 16],
    [154, 56, 15],
    [168, 74, 14],
    [172, 94, 11],
    [84, 100, 11],
  ];

  /** Image URLs that failed to load → render their token instead. */
  private readonly failedUrls = signal<ReadonlySet<string>>(new Set());

  protected markFailed(url: string): void {
    if (this.failedUrls().has(url)) return;
    this.failedUrls.update((s) => new Set(s).add(url));
  }

  protected onClick(): void {
    if (this.interactive()) this.avatarClick.emit();
  }

  protected onKeySpace(ev: Event): void {
    if (!this.interactive()) return;
    ev.preventDefault();
    this.avatarClick.emit();
  }

  /** Normalized base look (unknown / missing values → defaults). */
  protected readonly look = computed(() =>
    normalizeAvatarConfig(this.config() ?? null),
  );
  protected readonly poseName = computed<AvatarPose>(
    () => this.pose() ?? this.look().pose,
  );
  protected readonly skin = computed(() => SKIN_TONE_HEX[this.look().skinTone]);
  protected readonly half = computed(
    () => BODY_HALF[this.look().baseBodyId] ?? BODY_HALF['classic'],
  );

  protected readonly torsoPath = computed(() => {
    const l = 128 - this.half();
    const r = 128 + this.half();
    return `M${l} 214 L${l} 168 Q${l} 144 ${l + 26} 144 L${r - 26} 144 Q${r} 144 ${r} 168 L${r} 214 Z`;
  });

  /** Arm segments (shoulder → hand) for the current pose. */
  protected readonly arms = computed(() => {
    const l = 128 - this.half();
    const r = 128 + this.half();
    const left = { x1: l + 6, y1: 158 };
    const right = { x1: r - 6, y1: 158 };
    const down = (s: { x1: number; y1: number }, dx: number) => ({
      ...s,
      x2: s.x1 + dx,
      y2: 206,
    });
    const up = (s: { x1: number; y1: number }, dx: number) => ({
      ...s,
      x2: s.x1 + dx,
      y2: 108,
    });
    switch (this.poseName()) {
      case 'wave':
        return [down(left, -8), up(right, 22)];
      case 'cheer':
        return [up(left, -22), up(right, 22)];
      case 'study':
        return [
          { ...left, x2: 106, y2: 190 },
          { ...right, x2: 150, y2: 190 },
        ];
      default:
        return [down(left, -8), down(right, 8)];
    }
  });

  /** Image when resolved + loadable, else the token. */
  private sprite(s: AvatarSprite): { kind: SpriteKind; value: string } {
    const url = s.spriteUrl
      ? (this.resolver?.resolve(s.spriteUrl) ?? s.spriteUrl)
      : null;
    if (url && !this.failedUrls().has(url))
      return { kind: 'image', value: url };
    return parseSprite(s.spriteAssetId);
  }

  private glowFor(rarity: string | undefined): string | null {
    return rarity && RARITY_GLOW[rarity] ? `${this.uid}-glow-${rarity}` : null;
  }

  protected readonly glowDefs = computed(() => {
    const seen = new Set<string>();
    for (const s of Object.values(this.equipped()))
      if (s?.rarity && RARITY_GLOW[s.rarity]) seen.add(s.rarity);
    return [...seen].map((r) => ({
      id: `${this.uid}-glow-${r}`,
      color: RARITY_GLOW[r],
      blur: r === 'UNCOMMON' ? 2 : r === 'RARE' ? 3 : 4,
    }));
  });

  private layerFor(slot: AvatarSlot): AvatarLayer | null {
    const s = this.equipped()[slot];
    if (!s) return null;
    const p = this.sprite(s);
    return { slot, ...p, ...ANCHORS[slot], glow: this.glowFor(s.rarity) };
  }

  /** `color:` tokens on TOP / BOTTOM / SHOES tint the vector clothes. */
  protected tint(slot: AvatarSlot, fallback: string): string {
    const s = this.equipped()[slot];
    if (!s) return fallback;
    const p = this.sprite(s);
    return p.kind === 'color' ? p.value : fallback;
  }

  protected readonly hairItem = computed(() => !!this.equipped()['HAIR']);

  protected readonly background = computed(() => this.layerFor('BACKGROUND'));
  protected readonly bgFill = computed(() => {
    const bg = this.background();
    return bg?.kind === 'color'
      ? bg.value
      : 'var(--cdf-color-surface-2, #eef1f6)';
  });

  protected readonly pet = computed(() => this.layerFor('PET'));
  protected readonly frame = computed(() => this.layerFor('FRAME'));
  protected readonly ringFromFrame = computed(
    () => this.frame()?.kind === 'color',
  );
  protected readonly ringColor = computed(() => {
    const f = this.frame();
    return f?.kind === 'color' ? f.value : 'var(--cdf-color-primary, #5b8def)';
  });

  protected readonly itemNames = computed(() =>
    Object.values(this.equipped())
      .map((s) => s?.name)
      .filter((n): n is string => !!n),
  );

  /** Stacked item layers (BACKGROUND / PET / FRAME render separately). */
  protected readonly layers = computed<AvatarLayer[]>(() =>
    STACK_ORDER.map((slot) => this.layerFor(slot)).filter(
      (l): l is AvatarLayer => !!l,
    ),
  );
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
