import { Component, ChangeDetectionStrategy, input } from '@angular/core';

export interface KeyValueRow {
  key: string;
  value: string | number;
  hint?: string;
}

/**
 * Description-list pattern for detail panels (course metadata, user info,
 * subscription summary). Uses a real `<dl>` for screen-reader semantics.
 */
@Component({
  selector: 'cdf-key-value-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dl class="cdf-kv">
      @for (row of rows(); track row.key) {
      <div class="cdf-kv__row">
        <dt class="cdf-kv__key">
          {{ row.key }}
          @if (row.hint) {
          <span class="cdf-kv__hint">— {{ row.hint }}</span>
          }
        </dt>
        <dd class="cdf-kv__value">{{ row.value }}</dd>
      </div>
      }
    </dl>
  `,
  styleUrl: './key-value-list.scss',
})
export class KeyValueList {
  readonly rows = input.required<KeyValueRow[]>();
}
