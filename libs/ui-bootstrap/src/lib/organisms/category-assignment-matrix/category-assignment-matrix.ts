import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  model,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';

export interface MatrixPlan {
  id: string;
  name: string;
  /** Optional secondary text (price, interval). */
  hint?: string;
}

export interface MatrixCategory {
  id: string;
  name: string;
}

/** planId → included categoryIds. */
export type CategoryAssignments = Record<string, string[]>;

/** Pure toggle helper (keeps category order stable, no duplicates). */
export function toggleAssignment(
  value: CategoryAssignments,
  planId: string,
  categoryId: string,
  included: boolean,
  categoryOrder: readonly string[],
): CategoryAssignments {
  const current = new Set(value[planId] ?? []);
  if (included) current.add(categoryId);
  else current.delete(categoryId);
  return {
    ...value,
    [planId]: categoryOrder.filter((id) => current.has(id)),
  };
}

let matrixSeq = 0;

/**
 * Plans × categories grid of checkboxes deciding which content categories
 * each plan includes (docs/09). Rows are categories, columns are plans;
 * every cell is a native checkbox named "Include <category> in <plan>",
 * and each plan column has a select-all / clear-all header toggle.
 *
 *   <cdf-category-assignment-matrix [plans]="plans" [categories]="cats" [(value)]="assignments" />
 */
@Component({
  selector: 'cdf-category-assignment-matrix',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <div
      class="cdf-matrix"
      role="region"
      [attr.aria-labelledby]="captionId"
      tabindex="0"
    >
      <table class="cdf-matrix__table">
        <caption class="cdf-matrix__caption" [id]="captionId">
          {{
            caption() ?? ('ui.matrix.caption' | translate)
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col" class="cdf-matrix__corner">
              {{ 'ui.matrix.category' | translate }}
            </th>
            @for (plan of plans(); track plan.id) {
              <th scope="col" class="cdf-matrix__plan">
                <span class="cdf-matrix__plan-name">{{ plan.name }}</span>
                @if (plan.hint) {
                  <span class="cdf-matrix__plan-hint">{{ plan.hint }}</span>
                }
                <label class="cdf-matrix__all">
                  <input
                    type="checkbox"
                    [checked]="columnState(plan.id) === 'all'"
                    [indeterminate]="columnState(plan.id) === 'some'"
                    [disabled]="disabled()"
                    (change)="setColumn(plan.id, $any($event.target).checked)"
                  />
                  <span>{{ 'ui.matrix.allCategories' | translate }}</span>
                </label>
              </th>
            }
          </tr>
        </thead>
        <tbody>
          @for (cat of categories(); track cat.id) {
            <tr>
              <th scope="row" class="cdf-matrix__category">{{ cat.name }}</th>
              @for (plan of plans(); track plan.id) {
                <td class="cdf-matrix__cell">
                  <input
                    type="checkbox"
                    [checked]="isIncluded(plan.id, cat.id)"
                    [disabled]="disabled()"
                    [attr.aria-label]="
                      'ui.matrix.include'
                        | translate: { category: cat.name, plan: plan.name }
                    "
                    (change)="
                      toggle(plan.id, cat.id, $any($event.target).checked)
                    "
                  />
                </td>
              }
            </tr>
          } @empty {
            <tr>
              <td class="cdf-matrix__empty" [attr.colspan]="plans().length + 1">
                {{ 'ui.matrix.noCategories' | translate }}
              </td>
            </tr>
          }
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" class="cdf-matrix__category">
              {{ 'ui.matrix.total' | translate }}
            </th>
            @for (plan of plans(); track plan.id) {
              <td class="cdf-matrix__cell cdf-matrix__count">
                {{
                  'ui.matrix.count'
                    | translate
                      : { count: countFor(plan.id), total: categories().length }
                }}
              </td>
            }
          </tr>
        </tfoot>
      </table>
    </div>
  `,
  styleUrl: './category-assignment-matrix.scss',
})
export class CategoryAssignmentMatrix {
  readonly plans = input.required<MatrixPlan[]>();
  readonly categories = input.required<MatrixCategory[]>();
  /** Two-way bindable: planId → categoryIds. */
  readonly value = model<CategoryAssignments>({});
  readonly disabled = input(false);
  readonly caption = input<string | null>(null);

  protected readonly captionId = `cdf-matrix-${++matrixSeq}-caption`;
  private readonly order = computed(() => this.categories().map((c) => c.id));
  private readonly sets = computed(() => {
    const out = new Map<string, Set<string>>();
    for (const [plan, ids] of Object.entries(this.value()))
      out.set(plan, new Set(ids));
    return out;
  });

  protected isIncluded(planId: string, categoryId: string): boolean {
    return this.sets().get(planId)?.has(categoryId) ?? false;
  }

  protected countFor(planId: string): number {
    const set = this.sets().get(planId);
    return set ? this.order().filter((id) => set.has(id)).length : 0;
  }

  protected columnState(planId: string): 'none' | 'some' | 'all' {
    const n = this.countFor(planId);
    if (n === 0) return 'none';
    return n === this.order().length ? 'all' : 'some';
  }

  protected toggle(
    planId: string,
    categoryId: string,
    included: boolean,
  ): void {
    this.value.set(
      toggleAssignment(
        this.value(),
        planId,
        categoryId,
        included,
        this.order(),
      ),
    );
  }

  protected setColumn(planId: string, all: boolean): void {
    this.value.set({ ...this.value(), [planId]: all ? [...this.order()] : [] });
  }
}
