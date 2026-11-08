import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';

export interface BarPoint {
  /** Category label (already localized, e.g. a formatted week). */
  label: string;
  value: number;
  /** Localized value text (tooltip + table). */
  display: string;
}

/**
 * Single-series column chart (one hue — the primary token, magnitude only)
 * with a hover/focus tooltip per bar and a data table under a disclosure,
 * so nothing is conveyed by the graphic alone. The chart itself is
 * `aria-hidden`; the table is the accessible view.
 *
 *   <cdf-bar-chart [title]="t" [points]="pts" [valueHeader]="h" [labelHeader]="w" />
 */
@Component({
  selector: 'cdf-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <figure class="bc">
      <figcaption class="bc__title">{{ title() }}</figcaption>
      <div class="bc__plot" aria-hidden="true">
        @for (p of points(); track p.label) {
          <div class="bc__col" [attr.data-tip]="p.label + ' · ' + p.display">
            <div class="bc__bar" [style.height.%]="height(p.value)"></div>
          </div>
        }
      </div>
      <div class="bc__axis" aria-hidden="true">
        <span>{{ points()[0]?.label }}</span>
        <span>{{ points()[points().length - 1]?.label }}</span>
      </div>
      @if (withTable()) {
        <details class="bc__table">
          <summary>{{ 'admin.staff.chart.showTable' | translate }}</summary>
          <div class="table-scroll">
            <table class="admin-table">
              <caption class="visually-hidden">
                {{
                  title()
                }}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{{ labelHeader() }}</th>
                  <th scope="col" class="num">{{ valueHeader() }}</th>
                </tr>
              </thead>
              <tbody>
                @for (p of points(); track p.label) {
                  <tr>
                    <th scope="row">{{ p.label }}</th>
                    <td class="num">{{ p.display }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </details>
      }
    </figure>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .bc {
        margin: 0;
      }
      .bc__title {
        font-weight: 600;
        margin-bottom: var(--cdf-space-2);
      }
      .bc__plot {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: 140px;
        border-bottom: 1px solid var(--cdf-color-border);
      }
      .bc__col {
        position: relative;
        flex: 1 1 0;
        height: 100%;
        display: flex;
        align-items: flex-end;
        min-width: 6px;
      }
      .bc__bar {
        width: 100%;
        max-width: 28px;
        margin: 0 auto;
        min-height: 1px;
        background: var(--cdf-color-primary);
        border-radius: 4px 4px 0 0;
      }
      .bc__col:hover .bc__bar {
        opacity: 0.8;
      }
      .bc__col:hover::after {
        content: attr(data-tip);
        position: absolute;
        bottom: calc(100% + 4px);
        left: 50%;
        transform: translateX(-50%);
        white-space: nowrap;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 0.75rem;
        background: var(--cdf-color-text);
        color: var(--cdf-color-bg);
        z-index: 1;
        pointer-events: none;
      }
      .bc__axis {
        display: flex;
        justify-content: space-between;
        font-size: 0.75rem;
        color: var(--cdf-color-text-muted);
        margin-top: 4px;
      }
      .bc__table {
        margin-top: var(--cdf-space-2);
      }
      .bc__table summary {
        cursor: pointer;
        font-size: 0.875rem;
      }
    `,
  ],
})
export class BarChart {
  readonly title = input.required<string>();
  readonly points = input.required<BarPoint[]>();
  readonly labelHeader = input.required<string>();
  readonly valueHeader = input.required<string>();
  /** Off when the page already shows the same data in a table next to it. */
  readonly withTable = input(true);

  private readonly max = computed(() =>
    Math.max(0, ...this.points().map((p) => p.value)),
  );

  protected height(v: number): number {
    const m = this.max();
    return m > 0 ? Math.max(0, (v / m) * 100) : 0;
  }
}
