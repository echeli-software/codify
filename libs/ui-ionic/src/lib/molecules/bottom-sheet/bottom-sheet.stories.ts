import { Component, input, signal, type OnInit } from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';
import { AppButton } from '../../atoms/app-button/app-button.js';
import { BottomSheet } from './bottom-sheet.js';

@Component({
  selector: 'sb-bottom-sheet-demo',
  imports: [BottomSheet, AppButton],
  template: `
    <cdf-app-button (buttonClick)="open.set(true)">Open sheet</cdf-app-button>
    <cdf-bottom-sheet
      [(open)]="open"
      title="Filters"
      [dismissable]="dismissable()"
    >
      <p>Bottom sheet on phones, side panel from 768px. Esc closes it.</p>
      <label for="sb-sheet-level" style="display:block; margin: 8px 0 4px"
        >Level</label
      >
      <select id="sb-sheet-level">
        <option>Beginner</option>
        <option>Intermediate</option>
      </select>
      <div sheetFooter>
        <cdf-app-button kind="ghost" (buttonClick)="open.set(false)"
          >Reset</cdf-app-button
        >
        <cdf-app-button (buttonClick)="open.set(false)">Apply</cdf-app-button>
      </div>
    </cdf-bottom-sheet>
  `,
})
class BottomSheetDemo implements OnInit {
  readonly startOpen = input(true);
  readonly dismissable = input(true);
  protected readonly open = signal(false);

  ngOnInit(): void {
    this.open.set(this.startOpen());
  }
}

const meta: Meta<BottomSheetDemo> = {
  title: 'Molecules/BottomSheet',
  component: BottomSheetDemo,
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<BottomSheetDemo>;

export const Open: Story = { args: { startOpen: true } };
export const Closed: Story = { args: { startOpen: false } };
export const NotDismissable: Story = {
  args: { startOpen: true, dismissable: false },
};
