import type { Meta, StoryObj } from '@storybook/angular';
import { ICON_NAMES, Icon } from './icon.js';

const meta: Meta<Icon> = {
  title: 'Atoms/Icon',
  component: Icon,
  argTypes: {
    name: { control: 'select', options: [...ICON_NAMES] },
    size: { control: 'select', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
    label: { control: 'text' },
  },
};
export default meta;
type Story = StoryObj<Icon>;

export const Default: Story = { args: { name: 'check-circle', size: 'md' } };

export const AllSizes: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:16px; align-items:center;">
        <cdf-icon name="check-circle" size="xs" />
        <cdf-icon name="check-circle" size="sm" />
        <cdf-icon name="check-circle" size="md" />
        <cdf-icon name="check-circle" size="lg" />
        <cdf-icon name="check-circle" size="xl" />
      </div>
    `,
  }),
};

export const AllIcons: Story = {
  render: () => ({
    props: { names: [...ICON_NAMES] },
    template: `
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap:12px;">
        @for (name of names; track name) {
          <div style="display:flex; align-items:center; gap:8px; padding:8px; border:1px solid var(--cdf-color-border); border-radius:8px;">
            <cdf-icon [name]="name" size="md" />
            <small style="color: var(--cdf-color-text-muted);">{{ name }}</small>
          </div>
        }
      </div>
    `,
  }),
};
