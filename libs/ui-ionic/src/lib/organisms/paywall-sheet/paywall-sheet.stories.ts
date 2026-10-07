import type { Meta, StoryObj } from '@storybook/angular';
import { PaywallSheet, type PaywallContent } from './paywall-sheet.js';

const CONTENT: PaywallContent = {
  title: 'Codify Premium',
  subtitle: 'Unlock every course and earn twice the XP.',
  perks: [
    'All courses in your plan categories',
    '2× XP and coins',
    'Offline downloads',
    'Certificates',
  ],
  plans: [
    {
      id: 'm',
      name: 'Monthly',
      cadence: 'monthly',
      priceLabel: 'R$ 39,90/mês',
    },
    {
      id: 'y',
      name: 'Yearly',
      cadence: 'yearly',
      priceLabel: 'R$ 399,00/ano',
      badge: 'Save 17%',
      highlight: true,
    },
  ],
  footnote: 'Cancel anytime. Renews automatically.',
};

const meta: Meta<PaywallSheet> = {
  title: 'Organisms/PaywallSheet',
  component: PaywallSheet,
  parameters: { layout: 'fullscreen' },
  argTypes: {
    reason: {
      control: 'select',
      options: [
        'lesson-locked',
        'course-locked',
        'limit-reached',
        'feature-locked',
        'soft',
      ],
    },
  },
  args: { open: true, content: CONTENT, reason: 'lesson-locked' },
};
export default meta;
type Story = StoryObj<PaywallSheet>;

export const LessonLocked: Story = {};
export const LimitReached: Story = { args: { reason: 'limit-reached' } };
export const CustomTitle: Story = {
  args: { reason: 'soft', title: 'Black Week: 40% off' },
};
export const MonthlyOnly: Story = {
  args: { content: { ...CONTENT, plans: CONTENT.plans.slice(0, 1) } },
};
