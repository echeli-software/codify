import {
  Component,
  ChangeDetectionStrategy,
  computed,
  contentChildren,
  Directive,
  inject,
  input,
  output,
  signal,
  TemplateRef,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe } from '@codify/i18n';
import { Checkbox } from '../../atoms/checkbox/checkbox.js';
import { FormsModule } from '@angular/forms';
import { Icon } from '../../atoms/icon/icon.js';

export interface DataTableColumn<T> {
  /** Unique key for the column. Used for sort + template lookup. */
  key: string;
  label: string;
  /** Function to extract the cell value (used for default rendering + sort comparison). */
  value: (row: T) => string | number | boolean | Date | null;
  sortable?: boolean;
  width?: string; // CSS width (e.g. '120px', '20%')
  align?: 'start' | 'center' | 'end';
}

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: string;
  direction: SortDirection;
}

/**
 * Use to override the default cell rendering for a column:
 *
 *   <ng-template cdfDataTableCell="status" let-row>
 *     <cdf-badge [variant]="row.status">{{ row.status }}</cdf-badge>
 *   </ng-template>
 */
@Directive({ selector: '[cdfDataTableCell]' })
export class DataTableCell {
  readonly column = input.required<string>({ alias: 'cdfDataTableCell' });
  readonly tpl = inject<TemplateRef<unknown>>(TemplateRef);
}

@Component({
  selector: 'cdf-data-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, NgTemplateOutlet, Checkbox, Icon, TranslatePipe],
  template: `
    <div class="cdf-table-wrap">
      <table class="cdf-table">
        <thead>
          <tr>
            @if (selectable()) {
              <th class="cdf-table__select">
                <cdf-checkbox
                  [ariaLabel]="'ui.dataTable.selectAll' | translate"
                  [indeterminate]="someSelected()"
                  [ngModel]="allSelected()"
                  (ngModelChange)="onToggleAll($event)"
                />
              </th>
            }
            @for (col of columns(); track col.key) {
              <th
                [style.width]="col.width"
                [style.text-align]="col.align ?? 'start'"
                [class.cdf-table__th--sortable]="col.sortable"
                [attr.aria-sort]="ariaSortFor(col.key)"
              >
                @if (col.sortable) {
                  <button
                    type="button"
                    class="cdf-table__sort"
                    (click)="onSort(col.key)"
                  >
                    {{ col.label }}
                    @if (sort()?.key === col.key) {
                      <cdf-icon
                        [name]="
                          sort()!.direction === 'asc'
                            ? 'caret-up'
                            : 'caret-down'
                        "
                        size="xs"
                      />
                    }
                  </button>
                } @else {
                  {{ col.label }}
                }
              </th>
            }
            @if (rowActions()) {
              <th class="cdf-table__actions">
                <span class="visually-hidden">{{
                  'ui.dataTable.actions' | translate
                }}</span>
              </th>
            }
          </tr>
        </thead>

        <tbody>
          @for (row of rows(); track trackBy()(row)) {
            <tr [class.cdf-table__tr--selected]="isSelected(trackBy()(row))">
              @if (selectable()) {
                <td class="cdf-table__select">
                  <cdf-checkbox
                    [ariaLabel]="
                      'ui.dataTable.selectRow'
                        | translate: { index: $index + 1 }
                    "
                    [ngModel]="isSelected(trackBy()(row))"
                    (ngModelChange)="onToggleRow(trackBy()(row), $event)"
                  />
                </td>
              }
              @for (col of columns(); track col.key) {
                <td
                  [style.text-align]="col.align ?? 'start'"
                  [class.cdf-table__td--right]="col.align === 'end'"
                >
                  @if (cellTplFor(col.key); as tpl) {
                    <ng-container
                      *ngTemplateOutlet="
                        tpl;
                        context: { $implicit: row, row: row, col: col }
                      "
                    />
                  } @else {
                    {{ col.value(row) }}
                  }
                </td>
              }
              @if (rowActions(); as tpl) {
                <td class="cdf-table__actions">
                  <ng-container
                    *ngTemplateOutlet="
                      tpl;
                      context: { $implicit: row, row: row }
                    "
                  />
                </td>
              }
            </tr>
          } @empty {
            <tr>
              <td
                class="cdf-table__empty"
                [attr.colspan]="
                  columns().length +
                  (selectable() ? 1 : 0) +
                  (rowActions() ? 1 : 0)
                "
              >
                {{ emptyMessage() ?? ('ui.dataTable.empty' | translate) }}
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styleUrl: './data-table.scss',
})
export class DataTable<T> {
  readonly rows = input.required<readonly T[]>();
  readonly columns = input.required<DataTableColumn<T>[]>();
  /** How to extract a stable id per row. Defaults to row.id if present. */
  readonly trackBy = input<(row: T) => string | number>(
    (row) => (row as unknown as { id: string | number }).id,
  );
  readonly selectable = input(false);
  readonly emptyMessage = input<string | null>(null);
  /** Optional row-actions template projected via `<ng-template #actions let-row>…</ng-template>`. */
  readonly rowActions = input<TemplateRef<unknown> | null>(null);

  /** Current sort. Two-way bindable. */
  readonly sort = signal<SortState | null>(null);
  readonly sortChange = output<SortState | null>();

  /** Selected row ids. Two-way bindable; emits on change. */
  readonly selected = signal<Set<string | number>>(new Set());
  readonly selectionChange = output<(string | number)[]>();

  // Cell-template content children (alternative to `rowActions`).
  private readonly cellChildren = contentChildren(DataTableCell);
  private readonly cellMap = computed(() => {
    const map = new Map<string, TemplateRef<unknown>>();
    for (const c of this.cellChildren()) map.set(c.column(), c.tpl);
    return map;
  });

  protected readonly allSelected = computed(() => {
    const all = this.rows();
    if (all.length === 0) return false;
    return all.every((r) => this.selected().has(this.trackBy()(r)));
  });

  protected readonly someSelected = computed(() => {
    const ids = this.rows().map((r) => this.trackBy()(r));
    const picked = ids.filter((id) => this.selected().has(id)).length;
    return picked > 0 && picked < ids.length;
  });

  protected cellTplFor(key: string): TemplateRef<unknown> | null {
    return this.cellMap().get(key) ?? null;
  }

  protected ariaSortFor(
    key: string,
  ): 'ascending' | 'descending' | 'none' | null {
    const s = this.sort();
    if (!s || s.key !== key) return null;
    return s.direction === 'asc' ? 'ascending' : 'descending';
  }

  protected isSelected(id: string | number): boolean {
    return this.selected().has(id);
  }

  protected onSort(key: string): void {
    const cur = this.sort();
    let next: SortState | null;
    if (!cur || cur.key !== key) next = { key, direction: 'asc' };
    else if (cur.direction === 'asc') next = { key, direction: 'desc' };
    else next = null;
    this.sort.set(next);
    this.sortChange.emit(next);
  }

  protected onToggleRow(id: string | number, checked: boolean): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    this.selectionChange.emit([...this.selected()]);
  }

  protected onToggleAll(checked: boolean): void {
    const all = this.rows().map((r) => this.trackBy()(r));
    this.selected.set(checked ? new Set(all) : new Set());
    this.selectionChange.emit([...this.selected()]);
  }
}
