import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import { AppButton, BottomSheet } from '@codify/ui-ionic';
import { OfflineSyncService } from '../offline/offline-sync.service.js';
import { AppSessionService } from './app-session.service.js';

/** "You have unsynced progress. Sign out anyway?" (docs/16 §4 Sign-out). */
@Component({
  selector: 'cdf-sign-out-confirm',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppButton, BottomSheet, TranslatePipe],
  template: `
    <cdf-bottom-sheet
      [open]="session.signOutConfirm()"
      (openChange)="!$event && session.cancelSignOut()"
      [title]="'studentPlatform.session.signOutTitle' | translate"
    >
      <p data-testid="sign-out-confirm">
        {{
          'studentPlatform.session.signOutUnsynced'
            | translate: { count: sync.pendingCount() }
        }}
      </p>
      <div sheetFooter class="foot">
        <cdf-app-button kind="ghost" (buttonClick)="session.cancelSignOut()">
          {{ 'common.cancel' | translate }}
        </cdf-app-button>
        <cdf-app-button
          kind="danger"
          [loading]="session.signingOut()"
          (buttonClick)="session.signOut()"
        >
          {{ 'studentPlatform.session.signOutAnyway' | translate }}
        </cdf-app-button>
      </div>
    </cdf-bottom-sheet>
  `,
  styles: [
    `
      .foot {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        flex-wrap: wrap;
      }
    `,
  ],
})
export class SignOutConfirm {
  protected readonly session = inject(AppSessionService);
  protected readonly sync = inject(OfflineSyncService);
}
