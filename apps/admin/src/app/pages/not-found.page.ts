import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@codify/i18n';
import { Button, EmptyState } from '@codify/ui-bootstrap';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, EmptyState, RouterLink, TranslatePipe],
  template: `
    <div class="admin-page admin-page--narrow">
      <cdf-empty-state
        icon="search"
        [title]="'admin.notFound.title' | translate"
        [description]="'admin.notFound.description' | translate"
      >
        <cdf-button kind="primary" routerLink="/dashboard">
          {{ 'admin.notFound.home' | translate }}
        </cdf-button>
      </cdf-empty-state>
    </div>
  `,
})
export class NotFoundPage {}
