import type { Meta, StoryObj } from '@storybook/angular';
import { Badge } from './badge.js';

const meta: Meta<Badge> = {
  title: 'Atoms/Badge',
  component: Badge,
  argTypes: {
    variant: {
      control: 'select',
      options: ['neutral', 'primary', 'success', 'warning', 'danger', 'info', 'coin', 'xp', 'premium'],
    },
    subtle: { control: 'boolean' },
  },
  render: (args) => ({
    props: args,
    template: `<cdf-badge [variant]="variant" [subtle]="subtle">Badge</cdf-badge>`,
  }),
};
export default meta;
type Story = StoryObj<Badge>;

export const Primary: Story = { args: { variant: 'primary' } };
export const Coin: Story = { args: { variant: 'coin' } };
export const Premium: Story = { args: { variant: 'premium', subtle: true } };

export const AllVariants: Story = {
  render: () => ({
    template: `
      <div style="display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <cdf-badge variant="neutral">Neutral</cdf-badge>
          <cdf-badge variant="primary">Primary</cdf-badge>
          <cdf-badge variant="success">Success</cdf-badge>
          <cdf-badge variant="warning">Warning</cdf-badge>
          <cdf-badge variant="danger">Danger</cdf-badge>
          <cdf-badge variant="info">Info</cdf-badge>
          <cdf-badge variant="coin">Coin</cdf-badge>
          <cdf-badge variant="xp">XP</cdf-badge>
          <cdf-badge variant="premium">Premium</cdf-badge>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <cdf-badge variant="neutral" [subtle]="true">Neutral</cdf-badge>
          <cdf-badge variant="primary" [subtle]="true">Primary</cdf-badge>
          <cdf-badge variant="success" [subtle]="true">Success</cdf-badge>
          <cdf-badge variant="warning" [subtle]="true">Warning</cdf-badge>
          <cdf-badge variant="danger" [subtle]="true">Danger</cdf-badge>
          <cdf-badge variant="info" [subtle]="true">Info</cdf-badge>
          <cdf-badge variant="coin" [subtle]="true">Coin</cdf-badge>
          <cdf-badge variant="xp" [subtle]="true">XP</cdf-badge>
          <cdf-badge variant="premium" [subtle]="true">Premium</cdf-badge>
        </div>
      </div>
    `,
  }),
};
