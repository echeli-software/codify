import type { Meta, StoryObj } from '@storybook/angular';
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
  TOP: { spriteAssetId: 'emoji:👕', name: 'Tee' },
  PET: { spriteAssetId: 'emoji:🐈', name: 'Cat' },
  FRAME: { spriteAssetId: 'color:#ffd700', name: 'Gold Frame' },
};

const meta: Meta<AvatarRenderer> = {
  title: 'Molecules/AvatarRenderer',
  component: AvatarRenderer,
  render: (args) => ({
    props: args,
    template: `<cdf-avatar-renderer [config]="config" [equipped]="equipped" [size]="size" [level]="level" [showLevelRing]="showLevelRing" />`,
  }),
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
    config: { skinTone: 'light' },
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

export const SkinTones: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:16px;">
        @for (tone of ['porcelain','light','tan','brown','deep']; track tone) {
        <cdf-avatar-renderer [config]="{ skinTone: tone }" [size]="96" />
        }
      </div>
    `,
    moduleMetadata: { imports: [AvatarRenderer] },
  }),
};
