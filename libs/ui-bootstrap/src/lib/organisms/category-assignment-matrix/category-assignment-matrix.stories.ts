import { JsonPipe } from '@angular/common';
import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import {
  CategoryAssignmentMatrix,
  type MatrixCategory,
  type MatrixPlan,
} from './category-assignment-matrix.js';

const PLANS: MatrixPlan[] = [
  { id: 'free', name: 'Free' },
  { id: 'frontend', name: 'Frontend', hint: 'R$ 29,90/mês' },
  { id: 'pro', name: 'Pro', hint: 'R$ 59,90/mês' },
];
const CATEGORIES: MatrixCategory[] = [
  { id: 'web', name: 'Web' },
  { id: 'mobile', name: 'Mobile' },
  { id: 'ai', name: 'AI usage' },
  { id: 'soft', name: 'Soft skills' },
];

const meta: Meta<CategoryAssignmentMatrix> = {
  title: 'Organisms/CategoryAssignmentMatrix',
  component: CategoryAssignmentMatrix,
  decorators: [moduleMetadata({ imports: [JsonPipe] })],
};
export default meta;
type Story = StoryObj<CategoryAssignmentMatrix>;

export const Default: Story = {
  render: () => ({
    props: {
      plans: PLANS,
      categories: CATEGORIES,
      value: {
        free: ['soft'],
        frontend: ['web', 'mobile'],
        pro: ['web', 'mobile', 'ai', 'soft'],
      },
    },
    template: `
      <cdf-category-assignment-matrix [plans]="plans" [categories]="categories" [(value)]="value" />
      <pre style="font-size: 12px; margin-top: 12px">{{ value | json }}</pre>
    `,
  }),
};

export const Empty: Story = {
  render: () => ({
    props: { plans: PLANS, categories: CATEGORIES, value: {} },
    template: `<cdf-category-assignment-matrix [plans]="plans" [categories]="categories" [(value)]="value" />`,
  }),
};

export const Disabled: Story = {
  render: () => ({
    props: {
      plans: PLANS,
      categories: CATEGORIES,
      value: { pro: ['web', 'ai'] },
    },
    template: `<cdf-category-assignment-matrix [plans]="plans" [categories]="categories" [value]="value" [disabled]="true" caption="Read-only (no billing permission)" />`,
  }),
};

export const NoCategories: Story = {
  render: () => ({
    props: { plans: PLANS, categories: [] },
    template: `<cdf-category-assignment-matrix [plans]="plans" [categories]="categories" />`,
  }),
};
