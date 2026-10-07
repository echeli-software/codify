import type { Meta, StoryObj } from '@storybook/angular';
import { BlockMenu, blockMenuItemsFromRegistry } from './block-menu.js';

const meta: Meta<BlockMenu> = {
  title: 'Organisms/BlockMenu',
  component: BlockMenu,
  args: { items: blockMenuItemsFromRegistry(), label: 'Insert block' },
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<BlockMenu>;

export const AllBlocks: Story = {};

/** Opened by typing `/` then "vid" — the filter is pre-filled. */
export const Filtered: Story = {
  args: { initialQuery: 'video' },
};

export const InteractiveOnly: Story = {
  args: {
    items: blockMenuItemsFromRegistry().filter(
      (i) => i.group === 'interactive',
    ),
    label: 'Insert interactive block',
  },
};
