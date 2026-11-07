import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
} from '@angular/router';
import { provideI18n } from '@codify/i18n';
import { ConfirmDialogService } from '@codify/ui-bootstrap';
import {
  type HasUnsavedChanges,
  unsavedChangesGuard,
  warnOnUnload,
} from './unsaved-changes';

function runGuard(component: HasUnsavedChanges) {
  return TestBed.runInInjectionContext(() =>
    unsavedChangesGuard(
      component,
      {} as ActivatedRouteSnapshot,
      {} as RouterStateSnapshot,
      {} as RouterStateSnapshot,
    ),
  );
}

describe('unsavedChangesGuard', () => {
  const open = jest.fn();
  beforeEach(() => {
    open.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideI18n(),
        { provide: ConfirmDialogService, useValue: { open } },
      ],
    });
  });

  it('lets clean pages leave without asking', () => {
    expect(runGuard({ hasUnsavedChanges: () => false })).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it('asks before leaving a dirty page and follows the answer', async () => {
    open.mockResolvedValueOnce(true);
    await expect(runGuard({ hasUnsavedChanges: () => true })).resolves.toBe(
      true,
    );
    open.mockResolvedValueOnce(false);
    await expect(runGuard({ hasUnsavedChanges: () => true })).resolves.toBe(
      false,
    );
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmKind: 'danger',
        title: expect.any(String),
      }),
    );
  });

  it('treats a dismissed dialog as "stay"', async () => {
    open.mockResolvedValueOnce(undefined);
    await expect(runGuard({ hasUnsavedChanges: () => true })).resolves.toBe(
      false,
    );
  });
});

describe('warnOnUnload', () => {
  @Component({ template: '' })
  class Host {
    dirty = false;
    constructor() {
      warnOnUnload(() => this.dirty);
    }
  }

  it('blocks unload only while dirty and cleans up on destroy', () => {
    const fixture = TestBed.createComponent(Host);
    const fire = () => {
      const ev = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(fire()).toBe(false);
    fixture.componentInstance.dirty = true;
    expect(fire()).toBe(true);
    fixture.destroy();
    expect(fire()).toBe(false);
  });
});
