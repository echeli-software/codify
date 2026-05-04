import type { Meta, StoryObj } from '@storybook/angular';
import { AvatarWithFrame } from './avatar-with-frame.js';

const meta: Meta<AvatarWithFrame> = {
  title: 'Molecules/AvatarWithFrame',
  component: AvatarWithFrame,
  argTypes: {
    name: { control: 'text' },
    src: { control: 'text' },
    level: { control: 'number' },
    size: { control: 'select', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
  },
  render: (args) => ({
    props: args,
    template: `<cdf-avatar-with-frame [name]="name" [src]="src" [size]="size" [level]="level" />`,
  }),
};
export default meta;
type Story = StoryObj<AvatarWithFrame>;

export const Default: Story = { args: { name: 'Maria Souza', size: 'lg', level: 14 } };
export const NoLevel: Story = { args: { name: 'Lucas K.', size: 'lg' } };

export const AllSizes: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:16px; align-items:center;">
        <cdf-avatar-with-frame name="A B" size="xs" [level]="1" />
        <cdf-avatar-with-frame name="A B" size="sm" [level]="5" />
        <cdf-avatar-with-frame name="A B" size="md" [level]="14" />
        <cdf-avatar-with-frame name="A B" size="lg" [level]="22" />
        <cdf-avatar-with-frame name="A B" size="xl" [level]="42" />
      </div>
    `,
  }),
};
