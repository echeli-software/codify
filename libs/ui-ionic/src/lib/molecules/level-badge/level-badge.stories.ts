import type { Meta, StoryObj } from '@storybook/angular';
import { LevelBadge } from './level-badge.js';

const meta: Meta<LevelBadge> = {
  title: 'Molecules/LevelBadge',
  component: LevelBadge,
  argTypes: {
    level: { control: 'number' },
    size: { control: 'select', options: ['sm', 'md', 'lg', 'xl'] },
  },
  render: (args) => ({
    props: args,
    template: `<cdf-level-badge [level]="level" [size]="size" />`,
  }),
};
export default meta;
type Story = StoryObj<LevelBadge>;

export const Default: Story = { args: { level: 14, size: 'md' } };

export const TierProgression: Story = {
  render: () => ({
    template: `
      <div style="display:flex; gap:16px; align-items:center; flex-wrap:wrap;">
        <cdf-level-badge [level]="3" size="md" />   <!-- bronze -->
        <cdf-level-badge [level]="14" size="md" />  <!-- silver -->
        <cdf-level-badge [level]="22" size="md" />  <!-- gold -->
        <cdf-level-badge [level]="35" size="md" />  <!-- platinum -->
        <cdf-level-badge [level]="42" size="md" />  <!-- diamond -->
        <cdf-level-badge [level]="55" size="md" />  <!-- mythic -->
        <cdf-level-badge [level]="62" size="md" />  <!-- prestige -->
      </div>
    `,
  }),
};
