import {
  Directive,
  TemplateRef,
  ViewContainerRef,
  effect,
  inject,
  input,
} from '@angular/core';
import { AuthService } from './auth.service.js';
import type { UserRole } from './types.js';

/**
 * Structural directive — render the host template only if the current user
 * has any of the listed roles.
 *
 *   <button *codifyIfRole="['ADMIN','SUPPORT']">Promote user</button>
 *   <a *codifyIfRole="['STUDENT']">Open lesson</a>
 *
 * Empty list = "any authenticated user". Reactive: when the user signs out
 * or switches role (via the dev login), the view re-evaluates.
 */
@Directive({
  selector: '[codifyIfRole]',
})
export class RoleDirective {
  readonly codifyIfRole = input.required<readonly UserRole[]>();

  private readonly auth = inject(AuthService);
  private readonly tpl = inject(TemplateRef<unknown>);
  private readonly vcr = inject(ViewContainerRef);
  private rendered = false;

  constructor() {
    effect(() => {
      const ok =
        this.auth.isAuthenticated() && this.auth.hasAnyRole(this.codifyIfRole());
      if (ok && !this.rendered) {
        this.vcr.createEmbeddedView(this.tpl);
        this.rendered = true;
      } else if (!ok && this.rendered) {
        this.vcr.clear();
        this.rendered = false;
      }
    });
  }
}
