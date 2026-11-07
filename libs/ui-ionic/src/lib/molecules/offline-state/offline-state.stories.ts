import type { Meta, StoryObj } from '@storybook/angular';
import { OfflineState } from './offline-state.js';

const meta: Meta<OfflineState> = {
  title: 'Molecules/OfflineState',
  component: OfflineState,
};
export default meta;
type Story = StoryObj<OfflineState>;

export const Default: Story = { args: {} };
export const WithDownloads: Story = { args: { hasDownloads: true } };
export const WithQueuedCompletions: Story = {
  args: { hasDownloads: true, queued: 3 },
};
