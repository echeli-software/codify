import type { Meta, StoryObj } from '@storybook/angular';
import { BlockToolbar } from './block-toolbar.js';

const meta: Meta<BlockToolbar> = {
  title: 'Organisms/BlockToolbar',
  component: BlockToolbar,
  args: {
    state: { active: { paragraph: true }, disabled: { redo: true } },
    disabled: false,
  },
};
export default meta;
type Story = StoryObj<BlockToolbar>;

export const Default: Story = {};

export const ActiveMarks: Story = {
  args: {
    state: {
      active: { h2: true, bold: true, italic: true, link: true },
      disabled: {},
    },
  },
};

/** Cursor inside a table cell inside nothing else: table tools appear. */
export const InTable: Story = {
  args: { state: { active: { paragraph: true }, inTable: true } },
};

/** Cursor inside a callout: the callout style picker appears. */
export const InCallout: Story = {
  args: {
    state: { active: { callout: true, paragraph: true }, calloutKind: 'warn' },
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};
