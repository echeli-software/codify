import type { Meta, StoryObj } from '@storybook/angular';
import { AvatarRenderer, type AvatarSlot, type AvatarSprite } from './avatar-renderer.js';

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
  args: { config: { skinTone: 'tan' }, equipped: {}, size: 180, level: null, showLevelRing: false },
};

export const FullyDressed: Story = {
  args: { config: { skinTone: 'light' }, equipped: FULL, size: 180, level: 14, showLevelRing: true },
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
