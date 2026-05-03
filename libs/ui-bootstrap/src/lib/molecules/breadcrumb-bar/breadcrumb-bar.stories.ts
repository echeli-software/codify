import type { Meta, StoryObj } from '@storybook/angular';
import { BreadcrumbBar, type BreadcrumbCrumb } from './breadcrumb-bar.js';

const CRUMBS: BreadcrumbCrumb[] = [
  { label: 'Catalog', routerLink: ['/'] },
  { label: 'Courses', routerLink: ['/courses'] },
  { label: 'React Fundamentals' },
];

const meta: Meta<BreadcrumbBar> = {
  title: 'Molecules/BreadcrumbBar',
  component: BreadcrumbBar,
  args: { crumbs: CRUMBS },
};
export default meta;
type Story = StoryObj<BreadcrumbBar>;

export const Default: Story = {};
