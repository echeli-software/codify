import type { Meta, StoryObj } from '@storybook/angular';
import { Button } from './button.js';

const meta: Meta<Button> = {
  title: 'Atoms/Button',
  component: Button,
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
    template: `<cdf-button [kind]="kind" [size]="size" [type]="type" [disabled]="disabled" [loading]="loading" [fullWidth]="fullWidth">Button</cdf-button>`,
  }),
};
export default meta;
type Story = StoryObj<Button>;

export const Primary: Story = { args: { kind: 'primary', size: 'md' } };
export const Secondary: Story = { args: { kind: 'secondary', size: 'md' } };
export const Ghost: Story = { args: { kind: 'ghost', size: 'md' } };
export const Danger: Story = { args: { kind: 'danger', size: 'md' } };
export const Link: Story = { args: { kind: 'link', size: 'md' } };

export const Loading: Story = { args: { kind: 'primary', loading: true } };
export const Disabled: Story = { args: { kind: 'primary', disabled: true } };

export const AllSizes: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:12px; align-items:center;">
        <cdf-button size="sm">Small</cdf-button>
        <cdf-button size="md">Medium</cdf-button>
        <cdf-button size="lg">Large</cdf-button>
      </div>
    `,
  }),
};

export const AllVariants: Story = {
  render: () => ({
    template: `
      <div style="display:flex; flex-wrap:wrap; gap:12px;">
        <cdf-button kind="primary">Primary</cdf-button>
        <cdf-button kind="secondary">Secondary</cdf-button>
        <cdf-button kind="ghost">Ghost</cdf-button>
        <cdf-button kind="danger">Danger</cdf-button>
        <cdf-button kind="link">Link</cdf-button>
      </div>
    `,
  }),
};
