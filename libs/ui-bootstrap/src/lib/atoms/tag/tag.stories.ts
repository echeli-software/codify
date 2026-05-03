import type { Meta, StoryObj } from '@storybook/angular';
import { Tag } from './tag.js';

const meta: Meta<Tag> = {
  title: 'Atoms/Tag',
  component: Tag,
  argTypes: {
    removable: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  render: (args) => ({
    props: args,
    template: `<cdf-tag [removable]="removable" [disabled]="disabled">Frontend</cdf-tag>`,
  }),
};
export default meta;
type Story = StoryObj<Tag>;

export const Default: Story = { args: {} };
export const Removable: Story = { args: { removable: true } };
export const Disabled: Story = { args: { removable: true, disabled: true } };
