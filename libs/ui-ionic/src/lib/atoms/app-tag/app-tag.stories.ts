import type { Meta, StoryObj } from '@storybook/angular';
import { AppTag } from './app-tag.js';

const meta: Meta<AppTag> = {
  title: 'Atoms/AppTag',
  component: AppTag,
  render: (args) => ({
    props: args,
    template: `<cdf-app-tag [removable]="removable" [outline]="outline" [disabled]="disabled">React</cdf-app-tag>`,
  }),
  args: { removable: false, outline: true, disabled: false },
};
export default meta;
type Story = StoryObj<AppTag>;

export const Default: Story = {};
export const Removable: Story = { args: { removable: true } };
export const Filled: Story = { args: { outline: false, removable: true } };
export const Disabled: Story = { args: { removable: true, disabled: true } };
