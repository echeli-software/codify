// ToastHost has no standalone visual — it's a portal triggered by ToastService.
// See `toast.stories.ts` for an interactive demo wiring both pieces together.
import type { Meta, StoryObj } from '@storybook/angular';
import { ToastHost } from './toast-host.js';

const meta: Meta<ToastHost> = {
  title: 'Molecules/Toast/Host (empty)',
  component: ToastHost,
  parameters: {
    docs: {
      description: {
        component:
          'Mount once near app root. Renders nothing on its own — see Molecules/Toast for the interactive demo.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<ToastHost>;

export const EmptyHost: Story = {};
