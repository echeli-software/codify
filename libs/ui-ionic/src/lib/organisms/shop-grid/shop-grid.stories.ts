import type { Meta, StoryObj } from '@storybook/angular';
import { SAMPLE_ITEMS } from './sample-items.js';
import { ShopGrid } from './shop-grid.js';
import type { ShopItem } from './shop-item.js';

const MANY: ShopItem[] = Array.from({ length: 240 }, (_, i) => ({
  ...SAMPLE_ITEMS[i % SAMPLE_ITEMS.length],
  id: `bulk-${i}`,
  owned: false,
  name: `${SAMPLE_ITEMS[i % SAMPLE_ITEMS.length].name} #${i + 1}`,
}));

const meta: Meta<ShopGrid> = {
  title: 'Organisms/ShopGrid',
  component: ShopGrid,
  args: {
    items: SAMPLE_ITEMS,
    balance: 500,
    level: 10,
    isPremium: false,
    height: 520,
  },
};
export default meta;
type Story = StoryObj<ShopGrid>;

export const Default: Story = {};
export const PremiumUser: Story = {
  args: { isPremium: true, balance: 5000, level: 30 },
};
export const Broke: Story = { args: { balance: 20, level: 2 } };
/** 240 items — only visible rows are rendered (CDK virtual scroll). */
export const Virtualized: Story = { args: { items: MANY, balance: 800 } };
export const Empty: Story = { args: { items: [] } };
