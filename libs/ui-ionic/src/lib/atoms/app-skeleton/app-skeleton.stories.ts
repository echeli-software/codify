import type { Meta, StoryObj } from '@storybook/angular';
import { AppSkeleton } from './app-skeleton.js';

const meta: Meta<AppSkeleton> = {
  title: 'Atoms/AppSkeleton',
  component: AppSkeleton,
  argTypes: {
    shape: {
      control: 'inline-radio',
      options: ['rect', 'text', 'circle', 'pill'],
    },
  },
  args: { shape: 'rect', width: '100%', height: 120 },
};
export default meta;
type Story = StoryObj<AppSkeleton>;

export const Rect: Story = {};
export const CardPlaceholder: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:12px; align-items:center; max-width:420px">
        <cdf-app-skeleton shape="circle" [width]="48" [height]="48" />
        <div style="flex:1; display:flex; flex-direction:column; gap:8px">
          <cdf-app-skeleton shape="text" width="70%" />
          <cdf-app-skeleton shape="text" width="40%" />
        </div>
        <cdf-app-skeleton shape="pill" [width]="64" [height]="24" />
      </div>`,
  }),
};
