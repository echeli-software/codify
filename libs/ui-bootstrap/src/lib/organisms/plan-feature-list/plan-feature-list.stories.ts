import type { Meta, StoryObj } from '@storybook/angular';
import {
  PlanFeatureList,
  type PlanCategoryRef,
  type PlanFeature,
} from './plan-feature-list.js';

const CATEGORIES: PlanCategoryRef[] = [
  { id: 'frontend', label: 'Frontend' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'ai', label: 'AI usage' },
];
const FEATURES: PlanFeature[] = [
  { label: 'Unlimited course access', included: true },
  { label: '2x coin earning rate', included: true, hint: 'premium multiplier' },
  { label: 'Daily quest reroll', included: true },
  { label: 'Premium-only avatar items', included: true },
  { label: 'Live cohort sessions', included: false, hint: 'higher tier' },
];

const meta: Meta<PlanFeatureList> = {
  title: 'Organisms/PlanFeatureList',
  component: PlanFeatureList,
  args: { categories: CATEGORIES, features: FEATURES },
};
export default meta;
type Story = StoryObj<PlanFeatureList>;

export const FullPlan: Story = {};
export const FeaturesOnly: Story = { args: { categories: [], features: FEATURES } };
export const CategoriesOnly: Story = { args: { categories: CATEGORIES, features: [] } };
