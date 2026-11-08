import type { Meta, StoryObj } from '@storybook/angular';
import { SAMPLE_ITEMS } from '../shop-grid/sample-items.js';
import { Inventory } from './inventory.js';

const OWNED = SAMPLE_ITEMS.filter((i) => i.owned);
const MANY = SAMPLE_ITEMS.map((i, n) => ({
  ...i,
  owned: true,
  equipped: n === 1,
}));

const meta: Meta<Inventory> = {
  title: 'Organisms/Inventory',
  component: Inventory,
};
export default meta;
type Story = StoryObj<Inventory>;

export const Default: Story = { args: { items: OWNED } };
export const Saving: Story = { args: { items: OWNED, busyId: 'i4' } };
export const Empty: Story = { args: { items: [] } };
/** Rarity filter, name search and multi-select bulk equip (docs/08 §8). */
export const FiltersAndBulk: Story = { args: { items: MANY, bulk: true } };
/** No toolbar (compact embeds). */
export const Plain: Story = { args: { items: OWNED, filterable: false } };
