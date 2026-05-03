import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
} from '@angular/core';
import { IconButton } from '../../atoms/icon-button/icon-button.js';

/**
 * Numeric pagination. Renders 1…current ± 2…last with ellipses where the
 * sequence skips. For cursor-based feeds (no total count) use `cdf-cursor-pagination`
 * — to be added when the API endpoints land in Phase 5.
 */
@Component({
  selector: 'cdf-pagination',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconButton],
  template: `
    <nav class="cdf-pagination" aria-label="Pagination">
      <cdf-icon-button
        icon="caret-left"
        size="sm"
        ariaLabel="Previous page"
        kind="ghost"
        [disabled]="page() <= 1"
        (click)="goto(page() - 1)"
      />

      @for (item of items(); track $index) { @if (item === '…') {
      <span class="cdf-pagination__ellipsis" aria-hidden="true">…</span>
      } @else {
      <button
        type="button"
        class="cdf-pagination__page"
        [class.cdf-pagination__page--active]="item === page()"
        [attr.aria-current]="item === page() ? 'page' : null"
        (click)="goto($any(item))"
      >
        {{ item }}
      </button>
      } }

      <cdf-icon-button
        icon="caret-right"
        size="sm"
        ariaLabel="Next page"
        kind="ghost"
        [disabled]="page() >= totalPages()"
        (click)="goto(page() + 1)"
      />
    </nav>
  `,
  styleUrl: './pagination.scss',
})
export class Pagination {
  readonly page = input.required<number>();
  readonly totalPages = input.required<number>();
  /** Pages to show on each side of the current page. */
  readonly siblingCount = input(1);
  readonly pageChange = output<number>();

  protected readonly items = computed<(number | '…')[]>(() => {
    const total = this.totalPages();
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
}
