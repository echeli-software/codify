import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import { IconButton } from '../../atoms/icon-button/icon-button.js';

export type PaginationMode = 'numeric' | 'cursor';

export interface CursorPageEvent {
  direction: 'previous' | 'next';
  /** The cursor to fetch (`prevCursor` / `nextCursor`). */
  cursor: string | null;
}

/**
 * Pagination with two variants (docs/03 "numeric + cursor variants"):
 *
 *   numeric — 1…current ± siblings…last with ellipses:
 *     <cdf-pagination [page]="page" [totalPages]="12" (pageChange)="load($event)" />
 *
 *   cursor — for keyset feeds with no total count:
 *     <cdf-pagination mode="cursor" [prevCursor]="res.prev" [nextCursor]="res.next"
 *                     (cursorChange)="load($event.cursor)" />
 */
@Component({
  selector: 'cdf-pagination',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconButton, TranslatePipe],
  template: `
    <nav
      class="cdf-pagination"
      [attr.aria-label]="'ui.pagination.label' | translate"
    >
      @if (mode() === 'cursor') {
        <cdf-icon-button
          icon="caret-left"
          size="sm"
          [ariaLabel]="'ui.pagination.previous' | translate"
          kind="ghost"
          [disabled]="!hasPrevious()"
          (click)="cursor('previous')"
        />
        @if (pageLabel(); as label) {
          <span class="cdf-pagination__status" aria-live="polite">{{
            label
          }}</span>
        }
        <cdf-icon-button
          icon="caret-right"
          size="sm"
          [ariaLabel]="'ui.pagination.next' | translate"
          kind="ghost"
          [disabled]="!hasNext()"
          (click)="cursor('next')"
        />
      } @else {
        <cdf-icon-button
          icon="caret-left"
          size="sm"
          [ariaLabel]="'ui.pagination.previous' | translate"
          kind="ghost"
          [disabled]="page() <= 1"
          (click)="goto(page() - 1)"
        />

        @for (item of items(); track $index) {
          @if (item === '…') {
            <span class="cdf-pagination__ellipsis" aria-hidden="true">…</span>
          } @else {
            <button
              type="button"
              class="cdf-pagination__page"
              [class.cdf-pagination__page--active]="item === page()"
              [attr.aria-current]="item === page() ? 'page' : null"
              [attr.aria-label]="
                'ui.pagination.page' | translate: { page: item }
              "
              (click)="goto($any(item))"
            >
              {{ item }}
            </button>
          }
        }

        <cdf-icon-button
          icon="caret-right"
          size="sm"
          [ariaLabel]="'ui.pagination.next' | translate"
          kind="ghost"
          [disabled]="page() >= totalPages()"
          (click)="goto(page() + 1)"
        />
      }
    </nav>
  `,
  styleUrl: './pagination.scss',
})
export class Pagination {
  readonly mode = input<PaginationMode>('numeric');
  readonly page = input(1);
  readonly totalPages = input(1);
  /** Pages to show on each side of the current page. */
  readonly siblingCount = input(1);
  /** Cursor mode: cursor for the previous page (null = at start). */
  readonly prevCursor = input<string | null>(null);
  /** Cursor mode: cursor for the next page (null = at end). */
  readonly nextCursor = input<string | null>(null);
  /** Cursor mode: override "has previous" when the first page has no cursor. */
  readonly canGoBack = input<boolean | null>(null);
  /** Cursor mode: optional status text ("Showing 21–40"). */
  readonly pageLabel = input<string | null>(null);

  readonly pageChange = output<number>();
  readonly cursorChange = output<CursorPageEvent>();

  protected readonly hasPrevious = computed(
    () => this.canGoBack() ?? this.prevCursor() !== null,
  );
  protected readonly hasNext = computed(() => this.nextCursor() !== null);

  protected readonly items = computed<(number | '…')[]>(() => {
    const total = Math.max(1, this.totalPages());
    const current = this.page();
    const sibs = this.siblingCount();
    if (total <= 7 + sibs * 2) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const left = Math.max(2, current - sibs);
    const right = Math.min(total - 1, current + sibs);
    const arr: (number | '…')[] = [1];
    if (left > 2) arr.push('…');
    for (let i = left; i <= right; i++) arr.push(i);
    if (right < total - 1) arr.push('…');
    arr.push(total);
    return arr;
  });

  protected goto(p: number): void {
    if (p < 1 || p > this.totalPages() || p === this.page()) return;
    this.pageChange.emit(p);
  }

  protected cursor(direction: 'previous' | 'next'): void {
    if (direction === 'previous' && !this.hasPrevious()) return;
    if (direction === 'next' && !this.hasNext()) return;
    this.cursorChange.emit({
      direction,
      cursor: direction === 'next' ? this.nextCursor() : this.prevCursor(),
    });
  }
}
