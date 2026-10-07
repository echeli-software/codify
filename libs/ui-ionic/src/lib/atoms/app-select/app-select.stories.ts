import { FormsModule } from '@angular/forms';
import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { AppSelect, type AppSelectOption } from './app-select.js';

const GOALS: AppSelectOption[] = [
  { value: 'job', label: 'Get a dev job' },
  { value: 'upskill', label: 'Level up at work' },
  { value: 'fun', label: 'Just for fun' },
];

const meta: Meta<AppSelect> = {
  title: 'Atoms/AppSelect',
  component: AppSelect,
  decorators: [moduleMetadata({ imports: [FormsModule] })],
};
export default meta;
type Story = StoryObj<AppSelect>;

export const WithLabel: Story = {
  render: () => ({
    props: { goals: GOALS, v: 'upskill' },
    template: `<cdf-app-select ionLabel="Your goal" [options]="goals" [(ngModel)]="v" />`,
  }),
};
export const Placeholder: Story = {
  render: () => ({
    props: { goals: GOALS, v: null },
    template: `<cdf-app-select ionLabel="Your goal" placeholder="Pick one" interface="popover" [options]="goals" [(ngModel)]="v" />`,
  }),
};
export const LabelledByAria: Story = {
  render: () => ({
    props: { goals: GOALS, v: 'job' },
    template: `<cdf-app-select ariaLabel="Your goal" [options]="goals" [(ngModel)]="v" />`,
  }),
};
