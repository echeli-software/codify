import type { Meta, StoryObj } from '@storybook/angular';
import { PlanCard } from './plan-card.js';

const CATS = [
  { id: 'web', label: 'Web' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'ai', label: 'AI usage' },
];

const meta: Meta<PlanCard> = {
  title: 'Molecules/PlanCard',
  component: PlanCard,
  render: (args) => ({
    props: args,
    template: `<div style="max-width: 340px"><cdf-plan-card [name]="name" [description]="description" [amountCents]="amountCents" [currency]="currency" [period]="period" [installments]="installments" [compareAtCents]="compareAtCents" [categories]="categories" [features]="features" [badge]="badge" [highlight]="highlight" [current]="current" /></div>`,
  }),
  args: {
    name: 'Frontend',
    description: 'Every web and mobile course.',
    amountCents: 2990,
    currency: 'BRL',
    period: 'monthly',
    installments: null,
    compareAtCents: null,
    categories: CATS.slice(0, 2),
    features: ['2× XP on every lesson', 'Offline downloads', 'Certificates'],
    badge: null,
    highlight: false,
    current: false,
  },
};
export default meta;
type Story = StoryObj<PlanCard>;

export const Monthly: Story = {};
export const RecommendedAnnual: Story = {
  args: {
    name: 'Pro',
    amountCents: 47880,
    period: 'annual',
    installments: 12,
    categories: CATS,
    highlight: true,
  },
};
export const Promotion: Story = {
  args: { compareAtCents: 3990, badge: 'Save 25%' },
};
export const CurrentPlan: Story = { args: { current: true } };
