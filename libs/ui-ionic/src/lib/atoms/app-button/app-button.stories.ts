import type { Meta, StoryObj } from '@storybook/angular';
import { AppButton } from './app-button.js';

const meta: Meta<AppButton> = {
  title: 'Atoms/AppButton',
  component: AppButton,
  argTypes: {
    kind: { control: 'select', options: ['primary', 'secondary', 'ghost', 'danger', 'link'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    type: { control: 'select', options: ['button', 'submit', 'reset'] },
    disabled: { control: 'boolean' },
    loading: { control: 'boolean' },
    fullWidth: { control: 'boolean' },
  },
  render: (args) => ({
    props: args,
    template: `<cdf-app-button [kind]="kind" [size]="size" [type]="type" [disabled]="disabled" [loading]="loading" [fullWidth]="fullWidth">Button</cdf-app-button>`,
  }),
};
export default meta;
type Story = StoryObj<AppButton>;

export const Primary: Story = { args: { kind: 'primary', size: 'md' } };
export const Secondary: Story = { args: { kind: 'secondary', size: 'md' } };
export const Ghost: Story = { args: { kind: 'ghost', size: 'md' } };
export const Danger: Story = { args: { kind: 'danger', size: 'md' } };
export const Link: Story = { args: { kind: 'link', size: 'md' } };
export const Loading: Story = { args: { kind: 'primary', loading: true } };
export const Disabled: Story = { args: { kind: 'primary', disabled: true } };

export const AllVariants: Story = {
  render: () => ({
    template: `
      <div style="display:flex; flex-wrap:wrap; gap:12px;">
        <cdf-app-button kind="primary">Primary</cdf-app-button>
        <cdf-app-button kind="secondary">Secondary</cdf-app-button>
        <cdf-app-button kind="ghost">Ghost</cdf-app-button>
        <cdf-app-button kind="danger">Danger</cdf-app-button>
        <cdf-app-button kind="link">Link</cdf-app-button>
      </div>
    `,
  }),
};
