import type { Meta, StoryObj } from '@storybook/angular';
import { Icon, ICON_NAMES } from './icon.js';

const meta: Meta<Icon> = {
  title: 'Atoms/Icon',
  component: Icon,
  argTypes: {
    name: { control: 'select', options: ICON_NAMES as unknown as string[] },
    size: { control: 'select', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
    label: { control: 'text' },
  },
  render: (args) => ({
    props: args,
    template: `<cdf-icon [name]="name" [size]="size" [label]="label" />`,
  }),
};
export default meta;
type Story = StoryObj<Icon>;

export const Default: Story = { args: { name: 'flame', size: 'lg' } };

export const AllSizes: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:16px; align-items:center;">
        <cdf-icon name="flame" size="xs" />
        <cdf-icon name="flame" size="sm" />
        <cdf-icon name="flame" size="md" />
        <cdf-icon name="flame" size="lg" />
        <cdf-icon name="flame" size="xl" />
      </div>
    `,
  }),
};

export const Catalog: Story = {
  render: () => ({
    props: { names: ICON_NAMES },
    template: `
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(96px,1fr)); gap:8px;">
        @for (n of names; track n) {
          <div style="display:flex; flex-direction:column; align-items:center; gap:4px; padding:8px; border:1px solid var(--cdf-color-border); border-radius:8px;">
            <cdf-icon [name]="n" size="md" />
            <span style="font-size:10px; color:var(--cdf-color-text-muted); text-align:center;">{{ n }}</span>
          </div>
        }
      </div>
    `,
  }),
};
