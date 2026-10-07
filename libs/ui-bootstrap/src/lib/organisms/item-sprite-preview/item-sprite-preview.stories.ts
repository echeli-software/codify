import type { Meta, StoryObj } from '@storybook/angular';
import { ItemSpritePreview, type PreviewItem } from './item-sprite-preview.js';

const OUTFIT = {
  TOP: { spriteAssetId: 'emoji:👕', name: 'Tee' },
  BOTTOM: { spriteAssetId: 'emoji:👖', name: 'Jeans' },
  SHOES: { spriteAssetId: 'emoji:👟', name: 'Sneakers' },
};

const HAT: PreviewItem = {
  name: 'Wizard hat',
  slot: 'HAT',
  rarity: 'EPIC',
  spriteAssetId: 'emoji:🎩',
  costCoins: 450,
  requiredLevel: 8,
};

const meta: Meta<ItemSpritePreview> = {
  title: 'Organisms/ItemSpritePreview',
  component: ItemSpritePreview,
  args: { baseEquipped: OUTFIT, size: 200 },
};
export default meta;
type Story = StoryObj<ItemSpritePreview>;

export const Hat: Story = { args: { item: HAT } };
export const LegendaryPremiumGlasses: Story = {
  args: {
    item: {
      name: 'Golden shades',
      slot: 'GLASSES',
      rarity: 'LEGENDARY',
      spriteAssetId: 'emoji:🕶️',
      costCoins: 1200,
      isPremiumOnly: true,
    },
  },
};
export const ColorBackground: Story = {
  args: {
    item: {
      name: 'Sunset backdrop',
      slot: 'BACKGROUND',
      rarity: 'RARE',
      spriteAssetId: 'color:#fde68a',
    },
  },
};
export const Pet: Story = {
  args: {
    item: {
      name: 'Robo pup',
      slot: 'PET',
      rarity: 'UNCOMMON',
      spriteAssetId: 'emoji:🐶',
    },
  },
};
export const Untitled: Story = {
  args: {
    item: { name: '', slot: 'ACCESSORY', spriteAssetId: 'emoji:🎒' },
    size: 140,
  },
};
