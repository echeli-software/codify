import { Component, signal } from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';
import { AppButton } from '../../atoms/app-button/app-button.js';
import { CoinCounter } from './coin-counter.js';

@Component({
  selector: 'sb-coin-counter-demo',
  imports: [CoinCounter, AppButton],
  template: `
    <div style="display:flex; gap:12px; align-items:center">
      <cdf-coin-counter [value]="coins()" size="lg" />
      <cdf-app-button
        kind="secondary"
        size="sm"
        (buttonClick)="coins.set(coins() + 25)"
        >+25</cdf-app-button
      >
      <cdf-app-button
        kind="ghost"
        size="sm"
        (buttonClick)="coins.set(coins() - 40)"
        >−40</cdf-app-button
      >
    </div>
  `,
})
class CoinCounterDemo {
  protected readonly coins = signal(1240);
}

const meta: Meta<CoinCounter> = {
  title: 'Molecules/CoinCounter',
  component: CoinCounter,
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    animate: { control: 'boolean' },
    compact: { control: 'boolean' },
  },
};
export default meta;
type Story = StoryObj<CoinCounter>;

export const Default: Story = { args: { value: 1240 } };
export const Compact: Story = {
  args: { value: 125_400, compact: true, size: 'sm' },
};
export const Large: Story = { args: { value: 87, size: 'lg' } };
export const Animated: Story = {
  render: () => ({
    moduleMetadata: { imports: [CoinCounterDemo] },
    template: `<sb-coin-counter-demo />`,
  }),
};
