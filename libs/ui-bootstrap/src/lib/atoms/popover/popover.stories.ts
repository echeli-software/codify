import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { Button } from '../button/button.js';
import { Popover } from './popover.js';

/** Story-only trigger styled from tokens (Bootstrap .btn colours are compile-time). */
const TRIGGER_STYLE = `
  <style>
    .sb-trigger { padding: 6px 12px; border-radius: var(--cdf-radius-md); border: 1px solid var(--cdf-color-border);
      background: var(--cdf-color-surface); color: var(--cdf-color-primary-text); font: inherit; cursor: pointer; }
    .sb-trigger:focus-visible { outline: none; box-shadow: var(--cdf-shadow-focus-ring); }
  </style>`;

const meta: Meta<Popover> = {
  title: 'Atoms/Popover',
  component: Popover,
  decorators: [moduleMetadata({ imports: [Popover, Button] })],
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj<Popover>;

export const TextContent: Story = {
  render: () => ({
    template:
      TRIGGER_STYLE +
      `
      <div style="padding: 120px 40px">
        <button type="button" class="sb-trigger"
          cdfPopover="Premium includes every course in the Frontend and AI categories."
          cdfPopoverTitle="What's included"
          cdfPopoverPlacement="bottom">
          What's included?
        </button>
      </div>
    `,
  }),
};

export const TemplateContent: Story = {
  render: () => ({
    template:
      TRIGGER_STYLE +
      `
      <div style="padding: 160px 40px">
        <ng-template #rich>
          <p style="margin: 0 0 8px">2× XP on every lesson until Sunday.</p>
          <cdf-button kind="primary" size="sm">Got it</cdf-button>
        </ng-template>
        <button type="button" class="sb-trigger"
          [cdfPopover]="rich" cdfPopoverTitle="Weekend boost" cdfPopoverPlacement="top">
          Boost details
        </button>
      </div>
    `,
  }),
};

export const OpenOnHover: Story = {
  render: () => ({
    template:
      TRIGGER_STYLE +
      `
      <div style="padding: 120px 40px">
        <button type="button" class="sb-trigger"
          cdfPopover="Shown on hover and keyboard focus."
          cdfPopoverTriggers="mouseenter:mouseleave focus:blur">
          Hover me
        </button>
      </div>
    `,
  }),
};
