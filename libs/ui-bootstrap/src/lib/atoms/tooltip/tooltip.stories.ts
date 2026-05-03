import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { Button } from '../button/button.js';
import { Tooltip } from './tooltip.js';

const meta: Meta<Tooltip> = {
  title: 'Atoms/Tooltip',
  component: Tooltip,
  decorators: [moduleMetadata({ imports: [Button, Tooltip] })],
};
export default meta;
type Story = StoryObj<Tooltip>;

export const HoverTrigger: Story = {
  render: () => ({
    template: `<cdf-button kind="secondary" cdfTooltip="Save (Cmd-S)" cdfTooltipPlacement="top">Hover me</cdf-button>`,
  }),
};

export const PlacementVariants: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:24px; padding:48px;">
        <cdf-button kind="ghost" cdfTooltip="Top" cdfTooltipPlacement="top">Top</cdf-button>
        <cdf-button kind="ghost" cdfTooltip="Bottom" cdfTooltipPlacement="bottom">Bottom</cdf-button>
        <cdf-button kind="ghost" cdfTooltip="Left" cdfTooltipPlacement="left">Left</cdf-button>
        <cdf-button kind="ghost" cdfTooltip="Right" cdfTooltipPlacement="right">Right</cdf-button>
      </div>
    `,
  }),
};
