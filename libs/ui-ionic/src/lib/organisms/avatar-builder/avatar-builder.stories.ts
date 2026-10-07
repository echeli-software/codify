import type { Meta, StoryObj } from '@storybook/angular';
import { SAMPLE_ITEMS } from '../shop-grid/sample-items.js';
import { AvatarBuilder } from './avatar-builder.js';

const OWNED = SAMPLE_ITEMS.map((i) => ({ ...i, owned: true }));

const meta: Meta<AvatarBuilder> = {
  title: 'Organisms/AvatarBuilder',
  component: AvatarBuilder,
  args: { items: OWNED, config: { skinTone: 'brown' } },
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
