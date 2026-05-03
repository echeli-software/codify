import type { Meta, StoryObj } from '@storybook/angular';
import { MoneyInput } from './money-input.js';

const meta: Meta<MoneyInput> = {
  title: 'Organisms/MoneyInput',
  component: MoneyInput,
  argTypes: {
    currency: { control: 'select', options: ['BRL', 'USD'] },
    invalid: { control: 'boolean' },
  },
};
export default meta;
type Story = StoryObj<MoneyInput>;

export const BRL: Story = { args: { currency: 'BRL' } };
export const USD: Story = { args: { currency: 'USD' } };
