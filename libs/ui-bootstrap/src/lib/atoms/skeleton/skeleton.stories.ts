import type { Meta, StoryObj } from '@storybook/angular';
import { Skeleton } from './skeleton.js';

const meta: Meta<Skeleton> = {
  title: 'Atoms/Skeleton',
  component: Skeleton,
  argTypes: {
    shape: { control: 'select', options: ['rect', 'text', 'circle', 'pill'] },
    width: { control: 'text' },
    height: { control: 'text' },
  },
};
export default meta;
type Story = StoryObj<Skeleton>;

export const Default: Story = { args: { shape: 'rect', width: '100%', height: '120px' } };

export const ListItemPlaceholder: Story = {
  render: () => ({
    template: `
      <div style="display:flex; flex-direction:column; gap:12px; max-width:480px;">
        <div style="display:flex; gap:12px; align-items:center;">
          <cdf-skeleton shape="circle" width="36px" height="36px" />
          <div style="display:flex; flex-direction:column; gap:6px; flex:1;">
            <cdf-skeleton shape="text" width="60%" height="14px" />
            <cdf-skeleton shape="text" width="40%" height="12px" />
          </div>
        </div>
        <cdf-skeleton shape="rect" width="100%" height="120px" />
      </div>
    `,
  }),
};
