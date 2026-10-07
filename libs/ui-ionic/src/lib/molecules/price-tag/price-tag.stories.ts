import type { Meta, StoryObj } from '@storybook/angular';
import { PriceTag } from './price-tag.js';

const meta: Meta<PriceTag> = {
  title: 'Molecules/PriceTag',
  component: PriceTag,
  argTypes: {
    period: {
      control: 'inline-radio',
      options: ['monthly', 'annual', 'oneoff'],
    },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    currency: { control: 'inline-radio', options: ['BRL', 'USD'] },
  },
};
export default meta;
type Story = StoryObj<PriceTag>;

export const Monthly: Story = {
  args: { amountCents: 3990, currency: 'BRL', period: 'monthly' },
};
export const AnnualWithInstallments: Story = {
  args: {
    amountCents: 47880,
    currency: 'BRL',
    period: 'annual',
    installments: 12,
    size: 'lg',
  },
};
export const Promotion: Story = {
  args: {
    amountCents: 2990,
    compareAtCents: 3990,
    currency: 'BRL',
    period: 'monthly',
  },
};
export const OneOffUsd: Story = {
  args: { amountCents: 999, currency: 'USD', period: 'oneoff', size: 'sm' },
};
