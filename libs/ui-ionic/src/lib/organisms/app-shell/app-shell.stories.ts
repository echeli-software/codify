import type { Meta, StoryObj } from '@storybook/angular';
import { AppShell, type ShellTab } from './app-shell.js';

const TABS: ShellTab[] = [
  { path: 'today', label: 'Today', icon: 'home-outline' },
  { path: 'catalog', label: 'Courses', icon: 'school-outline' },
  { path: 'league', label: 'League', icon: 'podium-outline', badge: '3' },
  { path: 'shop', label: 'Shop', icon: 'cart-outline' },
  { path: 'profile', label: 'Profile', icon: 'person' },
];

const meta: Meta<AppShell> = {
  title: 'Organisms/AppShell',
  component: AppShell,
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    props: args,
    template: `<div style="height: 560px; position: relative"><cdf-app-shell [brand]="brand" [tabs]="tabs" /></div>`,
  }),
  args: { brand: 'Codify', tabs: TABS },
};
export default meta;
type Story = StoryObj<AppShell>;

export const Default: Story = {};
export const ThreeTabs: Story = { args: { tabs: TABS.slice(0, 3) } };
