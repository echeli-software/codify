import type { Meta, StoryObj } from '@storybook/angular';
import { ErrorState } from './error-state.js';

const meta: Meta<ErrorState> = {
  title: 'Molecules/ErrorState',
  component: ErrorState,
};
export default meta;
type Story = StoryObj<ErrorState>;

export const Default: Story = { args: {} };
export const WithCode: Story = {
  args: {
    title: 'Could not load the course',
    description: 'The server took too long to answer.',
    code: 'req_8f2a91',
  },
};
export const Retrying: Story = { args: { retrying: true } };
export const NotRetryable: Story = {
  args: {
    retryable: false,
    icon: 'lock',
    title: 'No access',
    description: 'This lesson needs a subscription.',
  },
};
