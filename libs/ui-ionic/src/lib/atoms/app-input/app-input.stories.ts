import { FormsModule } from '@angular/forms';
import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { AppInput } from './app-input.js';

const meta: Meta<AppInput> = {
  title: 'Atoms/AppInput',
  component: AppInput,
  decorators: [moduleMetadata({ imports: [FormsModule] })],
};
export default meta;
type Story = StoryObj<AppInput>;

export const Text: Story = {
  render: () => ({
    props: { v: '' },
    template: `<cdf-app-input ionLabel="Display name" placeholder="How should we call you?" [(ngModel)]="v" />`,
  }),
};
export const Email: Story = {
  render: () => ({
    props: { v: 'maria@example.com' },
    template: `<cdf-app-input type="email" ionLabel="Email" autocomplete="email" helper="We never share it." [(ngModel)]="v" />`,
  }),
};
export const Invalid: Story = {
  render: () => ({
    props: { v: 'maria@' },
    template: `<cdf-app-input type="email" ionLabel="Email" [invalid]="true" errorText="Enter a valid email." [(ngModel)]="v" />`,
  }),
};
export const Password: Story = {
  render: () => ({
    props: { v: 'secret' },
    template: `<cdf-app-input type="password" ionLabel="Password" [(ngModel)]="v" />`,
  }),
};
