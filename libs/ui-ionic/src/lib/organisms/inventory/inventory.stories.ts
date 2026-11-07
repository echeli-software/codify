import type { Meta, StoryObj } from '@storybook/angular';
import { SAMPLE_ITEMS } from '../shop-grid/sample-items.js';
import { Inventory } from './inventory.js';

const OWNED = SAMPLE_ITEMS.filter((i) => i.owned);

const meta: Meta<Inventory> = {
  title: 'Organisms/Inventory',
  component: Inventory,
};
export default meta;
type Story = StoryObj<Inventory>;

export const Default: Story = { args: { items: OWNED } };
export const Saving: Story = { args: { items: OWNED, busyId: 'i4' } };
export const Empty: Story = { args: { items: [] } };
