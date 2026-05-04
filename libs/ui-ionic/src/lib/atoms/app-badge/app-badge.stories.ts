import type { Meta, StoryObj } from '@storybook/angular';
import { AppBadge } from './app-badge.js';

const meta: Meta<AppBadge> = {
  title: 'Atoms/AppBadge',
  component: AppBadge,
  argTypes: {
    variant: {
      control: 'select',
      options: ['neutral', 'primary', 'success', 'warning', 'danger', 'info', 'coin', 'xp', 'premium'],
    },
    subtle: { control: 'boolean' },
  },
  render: (args) => ({
    props: args,
    template: `<cdf-app-badge [variant]="variant" [subtle]="subtle">Label</cdf-app-badge>`,
  }),
};
export default meta;
type Story = StoryObj<AppBadge>;

export const Default: Story = { args: { variant: 'primary' } };
export const Subtle: Story = { args: { variant: 'success', subtle: true } };

export const AllVariants: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <cdf-app-badge variant="neutral">Neutral</cdf-app-badge>
        <cdf-app-badge variant="primary">Primary</cdf-app-badge>
        <cdf-app-badge variant="success">Success</cdf-app-badge>
        <cdf-app-badge variant="warning">Warning</cdf-app-badge>
        <cdf-app-badge variant="danger">Danger</cdf-app-badge>
        <cdf-app-badge variant="info">Info</cdf-app-badge>
        <cdf-app-badge variant="coin">Coin</cdf-app-badge>
        <cdf-app-badge variant="xp">XP</cdf-app-badge>
        <cdf-app-badge variant="premium">Premium</cdf-app-badge>
      </div>
    `,
  }),
};
