// ModalFrame is meant to be projected into an NgbModal-mounted component;
// rendering it directly without an active modal context is non-trivial. The
// real demo lives under Molecules/ConfirmDialog (which uses ModalFrame's
// sibling pattern). This story serves as an API stub.
import type { Meta, StoryObj } from '@storybook/angular';
import { ModalFrame } from './modal-frame.js';

const meta: Meta<ModalFrame> = {
  title: 'Organisms/ModalFrame (notes)',
  component: ModalFrame,
  parameters: {
    docs: {
      description: {
        component:
          'Standard chrome (header/title/close + scrollable body + optional footer slot via [modalFooter]) for components mounted via ModalService. Cannot render in isolation — see Molecules/ConfirmDialog for a real example.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<ModalFrame>;

export const Notes: Story = {
  render: () => ({
    template: `<p style="color: var(--cdf-color-text-muted);">See Molecules/ConfirmDialog for a working modal demo.</p>`,
  }),
};
