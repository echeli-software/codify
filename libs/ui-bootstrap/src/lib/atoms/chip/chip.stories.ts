import type { Meta, StoryObj } from '@storybook/angular';
import { Chip } from './chip.js';

const meta: Meta<Chip> = {
  title: 'Atoms/Chip',
  component: Chip,
  argTypes: {
    variant: {
      control: 'select',
      options: ['neutral', 'primary', 'success', 'warning', 'danger'],
    },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
    selectable: { control: 'boolean' },
    selected: { control: 'boolean' },
    removable: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  render: (args) => ({
    props: args,
    template: `<cdf-chip [variant]="variant" [size]="size" [icon]="icon" [selectable]="selectable" [(selected)]="selected" [removable]="removable" [disabled]="disabled">Frontend</cdf-chip>`,
  }),
  args: {
    variant: 'neutral',
    size: 'md',
    icon: null,
    selectable: false,
    selected: false,
    removable: false,
    disabled: false,
  },
};
export default meta;
type Story = StoryObj<Chip>;

export const Default: Story = {};
export const WithIcon: Story = { args: { icon: 'star', variant: 'primary' } };
export const Removable: Story = { args: { removable: true } };
export const Selectable: Story = { args: { selectable: true } };
export const SelectedFilter: Story = {
  args: { selectable: true, selected: true },
};
export const Disabled: Story = { args: { removable: true, disabled: true } };

export const Variants: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:8px; flex-wrap:wrap">
        <cdf-chip>Neutral</cdf-chip>
        <cdf-chip variant="primary">Primary</cdf-chip>
        <cdf-chip variant="success">Success</cdf-chip>
        <cdf-chip variant="warning">Warning</cdf-chip>
        <cdf-chip variant="danger">Danger</cdf-chip>
        <cdf-chip size="sm" [removable]="true">Small</cdf-chip>
      </div>
    `,
  }),
};
