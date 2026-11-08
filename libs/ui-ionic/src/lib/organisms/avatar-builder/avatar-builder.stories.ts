import type { Meta, StoryObj } from '@storybook/angular';
import { SAMPLE_ITEMS } from '../shop-grid/sample-items.js';
import { AvatarBuilder } from './avatar-builder.js';

const OWNED = SAMPLE_ITEMS.map((i) => ({ ...i, owned: true }));

const meta: Meta<AvatarBuilder> = {
  title: 'Organisms/AvatarBuilder',
  component: AvatarBuilder,
  args: {
    items: OWNED,
    config: { skinTone: 'brown', baseHairStyle: 'curly' },
    autosaveMs: 3000,
  },
};
export default meta;
type Story = StoryObj<AvatarBuilder>;

export const Default: Story = {
  args: { equipped: { HAT: 'i2', TOP: 'i5', BOTTOM: 'i6' } },
};
export const Naked: Story = { args: { equipped: {} } };
export const Saving: Story = {
  args: { equipped: { HAT: 'i1' }, saving: true },
};
/** Every slot is browsable — an empty slot links to the shop. */
export const EmptySlot: Story = {
  args: {
    items: OWNED.filter((i) => i.slot !== 'EMOTE'),
    equipped: {},
    initialSlot: 'EMOTE',
  },
};
export const Randomizing: Story = {
  args: { equipped: { HAT: 'i1' }, randomizing: true, autosaveMs: 0 },
};
/** Pose picker preset to "cheer" (the celebrate pose). */
export const Cheering: Story = {
  args: {
    equipped: { HAT: 'i2' },
    config: { skinTone: 'tan', pose: 'cheer' },
    animate: true,
  },
};
