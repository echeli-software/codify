import type { Meta, StoryObj } from '@storybook/angular';
import { RadioGroup, type RadioOption } from './radio.js';

const OPTIONS: RadioOption<string>[] = [
  { value: '1', label: 'Iniciante' },
  { value: '2', label: 'Básico' },
  { value: '3', label: 'Intermediário' },
  { value: '4', label: 'Avançado' },
  { value: '5', label: 'Expert' },
];

const meta: Meta<RadioGroup<string>> = {
  title: 'Atoms/RadioGroup',
  component: RadioGroup,
  args: { options: OPTIONS, ariaLabel: 'Difficulty' },
  argTypes: { ariaLabel: { control: 'text' } },
};
export default meta;
type Story = StoryObj<RadioGroup<string>>;

export const Default: Story = {
  render: (args) => ({
    props: args,
    template: `<cdf-radio-group [options]="options" [ariaLabel]="ariaLabel" />`,
  }),
};
