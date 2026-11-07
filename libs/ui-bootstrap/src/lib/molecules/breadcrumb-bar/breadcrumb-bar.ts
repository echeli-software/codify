import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@codify/i18n';
import { Icon } from '../../atoms/icon/icon.js';

export interface BreadcrumbCrumb {
  label: string;
  /** Router commands array. Omit for the current (last) crumb. */
  routerLink?: unknown[];
}

@Component({
  selector: 'cdf-breadcrumb-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink, TranslatePipe],
  template: `
    <nav
      class="cdf-crumbs"
      [attr.aria-label]="ariaLabel() ?? ('ui.breadcrumb.label' | translate)"
    >
      @for (crumb of crumbs(); track crumb.label; let last = $last) {
        <span class="cdf-crumbs__item">
          @if (crumb.routerLink && !last) {
            <a class="cdf-crumbs__link" [routerLink]="crumb.routerLink">{{
              crumb.label
            }}</a>
          } @else {
            <span
              class="cdf-crumbs__current"
              [attr.aria-current]="last ? 'page' : null"
              >{{ crumb.label }}</span
            >
          }
          @if (!last) {
            <cdf-icon
              class="cdf-crumbs__sep"
              name="caret-right"
              size="xs"
              aria-hidden="true"
            />
          }
        </span>
      }
    </nav>
  `,
  styleUrl: './breadcrumb-bar.scss',
})
export class BreadcrumbBar {
  readonly crumbs = input.required<BreadcrumbCrumb[]>();
  readonly ariaLabel = input<string | null>(null);
}
