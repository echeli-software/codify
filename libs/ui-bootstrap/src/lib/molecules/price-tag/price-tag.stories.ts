import type { Meta, StoryObj } from '@storybook/angular';
import { PriceTag } from './price-tag.js';

const meta: Meta<PriceTag> = {
  title: 'Molecules/PriceTag',
  component: PriceTag,
  argTypes: {
    amountCents: { control: { type: 'number', min: 0 } },
    currency: { control: 'select', options: ['BRL', 'USD'] },
    period: { control: 'select', options: ['monthly', 'annual', 'oneoff'] },
    installments: { control: { type: 'number', min: 1, max: 24 } },
  },
};
export default meta;
type Story = StoryObj<PriceTag>;

export const MonthlyBRL: Story = { args: { amountCents: 3990, currency: 'BRL', period: 'monthly' } };
export const AnnualBRLWithInstallments: Story = {
  args: { amountCents: 47880, currency: 'BRL', period: 'annual', installments: 12 },
};
export const MonthlyUSD: Story = { args: { amountCents: 999, currency: 'USD', period: 'monthly' } };
