import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@codify/i18n';
import { AppButton, BottomSheet } from '@codify/ui-ionic';
import { DownloadService } from '../offline/download.service.js';
import { BytesPipe } from './bytes.pipe.js';

/**
 * "Make room?" sheet (docs/16 §5 + §12): when a download would exceed the
 * storage budget the download pauses and this asks before evicting the
 * least-recently-read courses — nothing is removed silently. Mounted once
 * in the shell so it works from any page that starts a download.
 */
@Component({
  selector: 'cdf-storage-prompt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppButton, BottomSheet, BytesPipe, TranslatePipe],
  template: `
    <cdf-bottom-sheet
      [open]="!!request()"
      (openChange)="!$event && answer(false)"
      [title]="'studentPlatform.storage.promptTitle' | translate"
    >
      @if (request(); as r) {
        <div data-testid="storage-prompt">
          <p>
            @if (r.title) {
              {{
                'studentPlatform.storage.promptBodyCourse'
                  | translate: { title: r.title, size: (r.overBytes | bytes) }
              }}
            } @else {
              {{
                'studentPlatform.storage.promptBodyBudget'
                  | translate: { size: (r.overBytes | bytes) }
              }}
            }
          </p>
          @if (r.evict.length > 0) {
            <p class="muted">
              {{ 'studentPlatform.storage.promptEvictList' | translate }}
            </p>
            <ul class="evict">
              @for (c of r.evict; track c.courseId) {
                <li>
                  <span>{{ c.title }}</span>
                  <span class="muted">{{ c.totalBytes | bytes }}</span>
                </li>
              }
            </ul>
          }
          @if (r.insufficient) {
            <p class="warn" role="alert">
              {{ 'studentPlatform.storage.promptInsufficient' | translate }}
            </p>
          }
        </div>
      }
      <div sheetFooter class="foot">
        @if (insufficient()) {
          <cdf-app-button kind="ghost" (buttonClick)="openSettings()">
            {{ 'studentPlatform.storage.raiseBudget' | translate }}
          </cdf-app-button>
        }
        <cdf-app-button kind="ghost" (buttonClick)="answer(false)">
          {{ 'common.cancel' | translate }}
        </cdf-app-button>
        @if (!insufficient()) {
          <cdf-app-button
            kind="danger"
            data-testid="storage-prompt-confirm"
            (buttonClick)="answer(true)"
          >
            {{ 'studentPlatform.storage.promptConfirm' | translate }}
          </cdf-app-button>
        }
      </div>
    </cdf-bottom-sheet>
  `,
  styles: [
    `
      .muted {
        color: var(--cdf-color-text-muted);
        font-size: 13px;
      }
      .warn {
        color: var(--cdf-color-danger);
        font-size: 13px;
      }
      .evict {
        list-style: none;
        padding: 0;
        margin: 0 0 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .evict li {
        display: flex;
        justify-content: space-between;
        gap: 8px;
      }
      .foot {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        flex-wrap: wrap;
      }
    `,
  ],
})
export class StoragePrompt {
  private readonly downloads = inject(DownloadService);
  private readonly router = inject(Router);
  protected readonly request = this.downloads.spaceRequest;
  protected readonly insufficient = computed(
    () => this.request()?.insufficient === true,
  );

  protected answer(accept: boolean): void {
    if (!this.request()) return;
    this.downloads.resolveSpaceRequest(accept);
  }

  protected openSettings(): void {
    this.answer(false);
    void this.router.navigateByUrl('/downloads');
  }
}
