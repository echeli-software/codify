import { Component, inject } from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { Button } from '../../atoms/button/button.js';
import { ConfirmDialogService } from './confirm-dialog.js';

@Component({
  selector: 'sb-confirm-demo',
  imports: [Button],
  template: `
    <div style="display:flex; gap:8px; flex-wrap:wrap;">
      <cdf-button kind="primary" (click)="simple()">Simple confirm</cdf-button>
      <cdf-button kind="danger" (click)="destructive()"
        >Type-to-confirm</cdf-button
      >
    </div>
    <p style="color: var(--cdf-color-text-muted); font-size: 14px;">
      Result: <code>{{ result }}</code>
    </p>
  `,
})
class ConfirmDemo {
  private readonly svc = inject(ConfirmDialogService);
  protected result = '—';

  async simple(): Promise<void> {
    const r = await this.svc.open({
      title: 'Save changes?',
      message: 'Apply your edits to the document.',
    });
    this.result = String(r);
  }

  async destructive(): Promise<void> {
    const r = await this.svc.open({
      title: 'Delete "react-fundamentals"?',
      message:
        'This action cannot be undone. All lessons and progress will be lost.',
      confirmKind: 'danger',
      confirmLabel: 'Delete',
      icon: 'warning',
      typeToConfirm: 'react-fundamentals',
    });
    this.result = String(r);
  }
}

const meta: Meta<ConfirmDemo> = {
  title: 'Molecules/ConfirmDialog',
  component: ConfirmDemo,
  decorators: [moduleMetadata({ imports: [ConfirmDemo] })],
};
export default meta;
type Story = StoryObj<ConfirmDemo>;

export const Interactive: Story = {};
