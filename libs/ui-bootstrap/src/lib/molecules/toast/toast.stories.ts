import { Component, inject } from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { Button } from '../../atoms/button/button.js';
import { ToastHost } from './toast-host.js';
import { ToastService } from './toast.service.js';

@Component({
  selector: 'sb-toast-demo',
  imports: [Button, ToastHost],
  template: `
    <div style="display:flex; gap:8px; flex-wrap:wrap;">
      <cdf-button kind="secondary" (click)="show('success')">Success</cdf-button>
      <cdf-button kind="secondary" (click)="show('info')">Info</cdf-button>
      <cdf-button kind="secondary" (click)="show('warn')">Warning</cdf-button>
      <cdf-button kind="secondary" (click)="show('error')">Error</cdf-button>
    </div>
    <cdf-toast-host />
  `,
})
class ToastDemo {
  private readonly svc = inject(ToastService);
  show(variant: 'success' | 'info' | 'warn' | 'error'): void {
    const messages = {
      success: 'Course saved.',
      info: 'Translation completeness updated.',
      warn: 'You have unsynced changes.',
      error: 'Could not connect to the server.',
    } as const;
    this.svc[variant](messages[variant], {
      title: variant.charAt(0).toUpperCase() + variant.slice(1),
      actionLabel: variant === 'error' ? 'Retry' : undefined,
    });
  }
}

const meta: Meta<ToastDemo> = {
  title: 'Molecules/Toast',
  component: ToastDemo,
  decorators: [moduleMetadata({ imports: [ToastDemo] })],
};
export default meta;
type Story = StoryObj<ToastDemo>;

export const Interactive: Story = {};
