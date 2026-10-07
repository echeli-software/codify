import { FormsModule } from '@angular/forms';
import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { AppCheckbox } from './app-checkbox.js';

const meta: Meta<AppCheckbox> = {
  title: 'Atoms/AppCheckbox',
  component: AppCheckbox,
  decorators: [moduleMetadata({ imports: [FormsModule] })],
};
export default meta;
type Story = StoryObj<AppCheckbox>;

export const Unchecked: Story = {
  render: () => ({
    props: { v: false },
    template: `<cdf-app-checkbox label="Email me weekly recaps" [(ngModel)]="v" />`,
  }),
};
export const Checked: Story = {
  render: () => ({
    props: { v: true },
    template: `<cdf-app-checkbox label="Remember me" [(ngModel)]="v" />`,
  }),
};
export const LabelStart: Story = {
  render: () => ({
    props: { v: true },
    template: `<cdf-app-checkbox label="Sound effects" labelPlacement="start" justify="space-between" [(ngModel)]="v" />`,
  }),
};
export const Disabled: Story = {
  render: () => ({
    props: { v: true },
    template: `<cdf-app-checkbox label="Locked option" [disabled]="true" [(ngModel)]="v" />`,
  }),
};
