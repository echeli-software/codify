import { FormsModule } from '@angular/forms';
import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { AppToggle } from './app-toggle.js';

const meta: Meta<AppToggle> = {
  title: 'Atoms/AppToggle',
  component: AppToggle,
  decorators: [moduleMetadata({ imports: [FormsModule] })],
};
export default meta;
type Story = StoryObj<AppToggle>;

export const Off: Story = {
  render: () => ({
    props: { v: false },
    template: `<cdf-app-toggle label="Daily reminder" [(ngModel)]="v" />`,
  }),
};
export const On: Story = {
  render: () => ({
    props: { v: true },
    template: `<cdf-app-toggle label="Sound effects" [(ngModel)]="v" />`,
  }),
};
export const Disabled: Story = {
  render: () => ({
    props: { v: true },
    template: `<cdf-app-toggle label="Push notifications" [disabled]="true" [(ngModel)]="v" />`,
  }),
};
