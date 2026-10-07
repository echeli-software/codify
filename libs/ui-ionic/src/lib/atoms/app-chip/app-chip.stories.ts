import type { Meta, StoryObj } from '@storybook/angular';
import { AppChip } from './app-chip.js';

const meta: Meta<AppChip> = {
  title: 'Atoms/AppChip',
  component: AppChip,
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'neutral',
        'primary',
        'success',
        'warning',
        'danger',
        'info',
        'coin',
        'xp',
      ],
    },
    outline: { control: 'boolean' },
  },
  render: (args) => ({
    props: args,
    template: `<cdf-app-chip [variant]="variant" [outline]="outline">Frontend</cdf-app-chip>`,
  }),
  args: { variant: 'primary', outline: false },
};
export default meta;
type Story = StoryObj<AppChip>;

export const Solid: Story = {};
export const Outline: Story = { args: { outline: true } };
export const AllVariants: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:8px; flex-wrap:wrap">
        <cdf-app-chip variant="neutral">Neutral</cdf-app-chip>
        <cdf-app-chip variant="primary">Primary</cdf-app-chip>
        <cdf-app-chip variant="success">Success</cdf-app-chip>
        <cdf-app-chip variant="warning">Warning</cdf-app-chip>
        <cdf-app-chip variant="danger">Danger</cdf-app-chip>
        <cdf-app-chip variant="info">Info</cdf-app-chip>
        <cdf-app-chip variant="coin">Coins</cdf-app-chip>
        <cdf-app-chip variant="xp">XP</cdf-app-chip>
      </div>`,
  }),
};
