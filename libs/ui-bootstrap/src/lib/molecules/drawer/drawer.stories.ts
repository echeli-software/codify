import { Component, input, signal } from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';
import { Button } from '../../atoms/button/button.js';
import { Drawer, type DrawerPosition, type DrawerSize } from './drawer.js';

@Component({
  selector: 'sb-drawer-demo',
  imports: [Drawer, Button],
  template: `
    <cdf-button kind="primary" (click)="open.set(true)">Open drawer</cdf-button>
    <cdf-drawer
      [(open)]="open"
      title="Edit course"
      [position]="position()"
      [size]="size()"
    >
      <label
        for="sb-drawer-title"
        style="display:block; font-size:14px; margin-bottom:4px"
        >Title</label
      >
      <input
        id="sb-drawer-title"
        class="form-control"
        value="React Fundamentals"
      />
      <p style="margin-top:16px">
        Tab cycles inside the drawer; Esc closes it and focus returns to the
        button.
      </p>
      <ng-container drawerFooter>
        <cdf-button kind="ghost" (click)="open.set(false)">Cancel</cdf-button>
        <cdf-button kind="primary" (click)="open.set(false)">Save</cdf-button>
      </ng-container>
    </cdf-drawer>
  `,
})
class DrawerDemo {
  readonly position = input<DrawerPosition>('end');
  readonly size = input<DrawerSize>('md');
  readonly startOpen = input(false);
  protected readonly open = signal(false);

  ngOnInit(): void {
    this.open.set(this.startOpen());
  }
}

const meta: Meta<DrawerDemo> = {
  title: 'Molecules/Drawer',
  component: DrawerDemo,
  argTypes: {
    position: { control: 'inline-radio', options: ['start', 'end', 'bottom'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<DrawerDemo>;

export const End: Story = {
  args: { position: 'end', size: 'md', startOpen: true },
};
export const Start: Story = {
  args: { position: 'start', size: 'sm', startOpen: true },
};
export const Bottom: Story = {
  args: { position: 'bottom', size: 'md', startOpen: true },
};
export const Closed: Story = {
  args: { position: 'end', size: 'lg', startOpen: false },
};
