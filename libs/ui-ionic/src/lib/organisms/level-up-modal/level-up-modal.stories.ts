import type { Meta, StoryObj } from '@storybook/angular';
import { LevelUpModal } from './level-up-modal.js';

const meta: Meta<LevelUpModal> = {
  title: 'Organisms/LevelUpModal',
  component: LevelUpModal,
  argTypes: {
    newLevel: { control: 'number' },
    xpForNext: { control: 'number' },
  },
  render: (args) => ({
    props: args,
    template: `
      <cdf-level-up-modal
        [open]="true"
        [newLevel]="newLevel"
        [xpForNext]="xpForNext"
      />
    `,
  }),
};
export default meta;
type Story = StoryObj<LevelUpModal>;

export const Bronze: Story = { args: { newLevel: 5, xpForNext: 220 } };
export const Silver: Story = { args: { newLevel: 14, xpForNext: 350 } };
export const Gold: Story = { args: { newLevel: 22, xpForNext: 500 } };
export const Diamond: Story = { args: { newLevel: 42, xpForNext: 800 } };
export const Mythic: Story = { args: { newLevel: 55, xpForNext: 1100 } };
