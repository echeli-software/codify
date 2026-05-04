import type { Meta, StoryObj } from '@storybook/angular';
import { AppCard } from './app-card.js';

const meta: Meta<AppCard> = {
  title: 'Atoms/AppCard',
  component: AppCard,
  argTypes: {
    elevation: { control: 'select', options: ['flat', 'raised'] },
    padding: { control: 'select', options: ['none', 'compact', 'normal', 'spacious'] },
  },
  render: (args) => ({
    props: args,
    template: `
      <cdf-app-card [elevation]="elevation" [padding]="padding">
        <h3 style="margin:0 0 8px;">Hello, card</h3>
        <p style="margin:0; color:var(--cdf-color-text-muted);">Slot in any content here.</p>
      </cdf-app-card>
    `,
  }),
};
export default meta;
type Story = StoryObj<AppCard>;

export const Default: Story = { args: { elevation: 'raised', padding: 'normal' } };
export const Flat: Story = { args: { elevation: 'flat', padding: 'normal' } };
export const Spacious: Story = { args: { elevation: 'raised', padding: 'spacious' } };
