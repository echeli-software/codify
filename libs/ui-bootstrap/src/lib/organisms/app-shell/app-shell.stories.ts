import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { AppShell, type NavSection } from './app-shell.js';
import { Avatar } from '../../atoms/avatar/avatar.js';

const NAV: NavSection[] = [
  { items: [{ label: 'Dashboard', icon: 'gear', routerLink: ['/'] }] },
  {
    label: 'Catalog',
    items: [
      { label: 'Courses', icon: 'pencil', routerLink: ['/courses'], badge: '5' },
      { label: 'Lessons', icon: 'pencil', routerLink: ['/lessons'] },
      { label: 'Categories', icon: 'menu', routerLink: ['/categories'] },
    ],
  },
  {
    label: 'Ops',
    items: [
      { label: 'Plans', icon: 'pencil', routerLink: ['/plans'] },
      { label: 'Users', icon: 'user-circle', routerLink: ['/users'] },
    ],
  },
];

const meta: Meta<AppShell> = {
  title: 'Organisms/AppShell',
  component: AppShell,
  decorators: [moduleMetadata({ imports: [AppShell, Avatar] })],
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<AppShell>;

export const Default: Story = {
  render: () => ({
    props: { brand: 'Codify · Admin', brandIcon: 'gear', nav: NAV },
    template: `
      <cdf-app-shell [brand]="brand" [brandIcon]="brandIcon" [nav]="nav" style="display:block; height:600px;">
        <ng-container appShellTopbarRight>
          <cdf-avatar name="Maria Souza" size="sm" />
        </ng-container>
        <div style="padding: 24px;">
          <h1>Page content</h1>
          <p style="color: var(--cdf-color-text-muted);">
            Resize the canvas or use the chevron in the sidebar foot to toggle collapse.
          </p>
        </div>
      </cdf-app-shell>
    `,
  }),
};
