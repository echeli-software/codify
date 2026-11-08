import type { Meta, StoryObj } from '@storybook/angular';
import {
  AVATAR_POSES,
  BASE_BODIES,
  HAIR_COLORS,
  HAIR_STYLES,
  SKIN_TONES,
} from '@codify/ui-core';
import {
  AvatarRenderer,
  type AvatarSlot,
  type AvatarSprite,
} from './avatar-renderer.js';
import { SAMPLE_SPRITE_URLS } from '../../atoms/item-sprite/sample-sprites.js';

const FULL: Partial<Record<AvatarSlot, AvatarSprite>> = {
  BACKGROUND: { spriteAssetId: 'color:#cfe3ff', name: 'Sky' },
  HAT: { spriteAssetId: 'emoji:🧢', name: 'Cap' },
  GLASSES: { spriteAssetId: 'emoji:🕶️', name: 'Sunglasses' },
  TOP: { spriteAssetId: 'color:#e4572e', name: 'Red tee' },
  BOTTOM: { spriteAssetId: 'color:#264653', name: 'Jeans' },
  PET: { spriteAssetId: 'emoji:🐈', name: 'Cat' },
  FRAME: { spriteAssetId: 'color:#ffd700', name: 'Gold Frame' },
};

const meta: Meta<AvatarRenderer> = {
  title: 'Molecules/AvatarRenderer',
  component: AvatarRenderer,
  render: (args) => ({
    props: args,
    template: `<cdf-avatar-renderer [config]="config" [equipped]="equipped" [size]="size" [level]="level" [showLevelRing]="showLevelRing" [pose]="pose" [animate]="animate" [interactive]="interactive" />`,
  }),
  args: {
    pose: null,
    animate: false,
    interactive: false,
  },
};
export default meta;
type Story = StoryObj<AvatarRenderer>;

export const BaseOnly: Story = {
  args: {
    config: { skinTone: 'tan' },
    equipped: {},
    size: 180,
    level: null,
    showLevelRing: false,
  },
};

export const FullyDressed: Story = {
  args: {
    config: {
      skinTone: 'light',
      baseHairStyle: 'long',
      baseHairColor: HAIR_COLORS[3],
    },
    equipped: FULL,
    size: 180,
    level: 14,
    showLevelRing: true,
  },
};

/** Uploaded sprites (API `spriteUrl`) mixed with inline tokens. */
export const UploadedSprites: Story = {
  args: {
    config: { skinTone: 'tan' },
    equipped: {
      BACKGROUND: { spriteAssetId: 'color:#e7f5ff', name: 'Sky' },
      HAT: {
        spriteAssetId: '01960000-0000-7000-8000-000000000001',
        spriteUrl: SAMPLE_SPRITE_URLS.crown,
        name: 'Crown',
      },
      ACCESSORY: {
        spriteAssetId: '01960000-0000-7000-8000-000000000002',
        spriteUrl: SAMPLE_SPRITE_URLS.scarf,
        name: 'Scarf',
      },
      FRAME: {
        spriteAssetId: '01960000-0000-7000-8000-000000000003',
        spriteUrl: SAMPLE_SPRITE_URLS.frame,
        name: 'Royal frame',
      },
    },
    size: 180,
    level: null,
    showLevelRing: false,
  },
};

/** All 8 skin tones (docs/08 §5). */
export const SkinTones: Story = {
  render: () => ({
    props: { tones: SKIN_TONES },
    template: `
      <div style="display:flex; gap:12px; flex-wrap:wrap;">
        @for (tone of tones; track tone) {
          <cdf-avatar-renderer [config]="{ skinTone: tone }" [size]="96" />
        }
      </div>
    `,
    moduleMetadata: { imports: [AvatarRenderer] },
  }),
};

/** Base hair styles × base bodies. */
export const HairAndBodies: Story = {
  render: () => ({
    props: { styles: HAIR_STYLES, bodies: BASE_BODIES, colors: HAIR_COLORS },
    template: `
      <div style="display:flex; gap:12px; flex-wrap:wrap;">
        @for (h of styles; track h; let i = $index) {
          <cdf-avatar-renderer
            [config]="{ baseHairStyle: h, baseHairColor: colors[i % colors.length], baseBodyId: bodies[i % bodies.length], skinTone: 'olive' }"
            [size]="96"
          />
        }
      </div>
    `,
    moduleMetadata: { imports: [AvatarRenderer] },
  }),
};

/** Poses: idle / wave / cheer (celebrate) / study. */
export const Poses: Story = {
  render: () => ({
    props: { poses: AVATAR_POSES, equipped: FULL },
    template: `
      <div style="display:flex; gap:12px; flex-wrap:wrap;">
        @for (p of poses; track p) {
          <cdf-avatar-renderer [config]="{ skinTone: 'brown', baseHairStyle: 'coily' }" [equipped]="equipped" [pose]="p" [size]="120" />
        }
      </div>
    `,
    moduleMetadata: { imports: [AvatarRenderer] },
  }),
};

/** Rarity glow per item (a filter applied by the renderer). */
export const RarityGlow: Story = {
  args: {
    config: { skinTone: 'fair', baseHairStyle: 'curly' },
    equipped: {
      HAT: { spriteAssetId: 'emoji:👑', name: 'Crown', rarity: 'LEGENDARY' },
      GLASSES: { spriteAssetId: 'emoji:🥽', name: 'Goggles', rarity: 'RARE' },
      PET: { spriteAssetId: 'emoji:🐉', name: 'Dragon', rarity: 'EPIC' },
    },
    size: 180,
    level: null,
    showLevelRing: false,
  },
};

/** Tap-to-customize: a focusable button that emits `avatarClick`. */
export const Interactive: Story = {
  args: {
    config: { skinTone: 'dark', pose: 'wave' },
    equipped: FULL,
    size: 140,
    level: 3,
    showLevelRing: true,
    interactive: true,
    animate: true,
  },
};
