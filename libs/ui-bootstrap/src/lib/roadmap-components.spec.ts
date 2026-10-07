import {
  Component,
  input,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { I18nService, provideI18n } from '@codify/i18n';
import { Combobox, type ComboboxOption } from './atoms/combobox/combobox.js';
import { Select } from './atoms/select/select.js';
import { Pagination } from './molecules/pagination/pagination.js';
import { Drawer } from './molecules/drawer/drawer.js';
import { matchesAccept } from './molecules/file-uploader/file-uploader.js';
import {
  clampOffsets,
  cropRect,
  initialCrop,
  minCoverScale,
  zoomTo,
} from './molecules/image-cropper/crop-math.js';
import { isInvertedRange } from './molecules/date-range-picker/date-range-picker.js';
import { ModalService } from './organisms/modal/modal.service.js';
import {
  emptyMultiplier,
  scopeOf,
  validateMultiplier,
} from './organisms/multiplier-editor/multiplier-editor.js';
import { toggleAssignment } from './organisms/category-assignment-matrix/category-assignment-matrix.js';
import { CategoryAssignmentMatrix } from './organisms/category-assignment-matrix/category-assignment-matrix.js';
import { DataTable } from './organisms/data-table/data-table.js';
import { ConfirmDialogService } from './molecules/confirm-dialog/confirm-dialog.js';

const providers = [provideZonelessChangeDetection(), provideI18n()];

/** Pin the locale so assertions don't depend on navigator.language. */
beforeEach(() => {
  TestBed.configureTestingModule({ providers });
  TestBed.inject(I18nService).setLocale('pt-BR');
});

describe('pure helpers', () => {
  it('matchesAccept handles extensions, wildcards and exact MIME', () => {
    const png = { name: 'cover.PNG', type: 'image/png' };
    expect(matchesAccept(png, 'image/*')).toBe(true);
    expect(matchesAccept(png, '.png,.svg')).toBe(true);
    expect(matchesAccept(png, 'image/jpeg')).toBe(false);
    expect(
      matchesAccept(
        { name: 'a.pdf', type: 'application/pdf' },
        'image/*, .pdf',
      ),
    ).toBe(true);
  });

  it('crop math keeps the image covering the viewport', () => {
    const s = initialCrop(1600, 1000, 320, 180);
    expect(s.scale).toBeCloseTo(minCoverScale(s));
    const r = cropRect(s);
    expect(r.sw / r.sh).toBeCloseTo(320 / 180);
    const dragged = clampOffsets({ ...s, offsetX: 500, offsetY: -5000 });
    expect(dragged.offsetX).toBe(0);
    expect(dragged.offsetY).toBe(180 - 1000 * s.scale);
    const zoomed = zoomTo(s, s.scale * 2);
    expect(cropRect(zoomed).sw).toBeCloseTo(r.sw / 2);
    expect(zoomTo(s, 0.0001).scale).toBeCloseTo(s.scale); // never below cover
  });

  it('isInvertedRange', () => {
    expect(isInvertedRange({ start: '2026-01-02', end: '2026-01-01' })).toBe(
      true,
    );
    expect(isInvertedRange({ start: '2026-01-01', end: null })).toBe(false);
  });

  it('validateMultiplier covers value, schedule, scope and streak rules', () => {
    expect(validateMultiplier(emptyMultiplier())).toEqual([]);
    expect(
      validateMultiplier(
        {
          ...emptyMultiplier(),
          kind: 'STREAK_TIER',
          value: 31,
          startsAt: '2026-02-01T00:00',
          endsAt: '2026-01-01T00:00',
        },
        'lesson',
      ),
    ).toEqual([
      'valueRange',
      'scheduleOrder',
      'lessonRequired',
      'streakDaysRequired',
    ]);
    expect(scopeOf({ courseId: 'c', lessonId: null })).toBe('course');
    expect(scopeOf({ courseId: 'c', lessonId: 'l' })).toBe('lesson');
  });

  it('toggleAssignment keeps category order and removes duplicates', () => {
    const order = ['a', 'b', 'c'];
    let v = toggleAssignment({}, 'p', 'c', true, order);
    v = toggleAssignment(v, 'p', 'a', true, order);
    v = toggleAssignment(v, 'p', 'a', true, order);
    expect(v['p']).toEqual(['a', 'c']);
    expect(toggleAssignment(v, 'p', 'a', false, order)['p']).toEqual(['c']);
  });
});

describe('ModalService', () => {
  @Component({
    selector: 'cdf-test-modal',
    template: `{{ courseId() }}|{{ plain }}`,
  })
  class SignalModal {
    readonly courseId = input<string>('none');
    plain = '';
  }

  afterEach(() => TestBed.inject(NgbModal).dismissAll());

  it('sets signal inputs via setInput and other props directly', async () => {
    const ref = TestBed.inject(ModalService).open(SignalModal, {
      inputs: { courseId: 'react', plain: 'x' } as never,
      animation: false,
    });
    const cmp = ref.componentInstance as SignalModal;
    expect(cmp.courseId()).toBe('react');
    expect(cmp.plain).toBe('x');
    await new Promise((r) => setTimeout(r));
    expect(document.body.textContent).toContain('react|x');
  });
});

describe('ConfirmDialog', () => {
  it('labels the type-to-confirm input', async () => {
    void TestBed.inject(ConfirmDialogService).open(
      { title: 'Delete', message: 'Sure?', typeToConfirm: 'abc' },
      { animation: false },
    );
    await new Promise((r) => setTimeout(r));
    const input = document.querySelector<HTMLInputElement>(
      '.cdf-confirm__input',
    )!;
    const label = document.querySelector<HTMLLabelElement>(
      `label[for="${input.id}"]`,
    );
    expect(label?.textContent).toContain('abc');
    TestBed.inject(NgbModal).dismissAll();
  });
});

describe('Combobox', () => {
  const OPTS: ComboboxOption[] = [
    { value: 'r', label: 'React' },
    { value: 'a', label: 'Angular' },
    { value: 'x', label: 'Archived', disabled: true },
    { value: 'n', label: 'Node' },
  ];

  @Component({
    imports: [Combobox, FormsModule],
    template: `<cdf-combobox
      [options]="opts"
      ariaLabel="Course"
      [(ngModel)]="value"
    />`,
  })
  class Host {
    opts = OPTS;
    value: string | null = null;
  }

  it('implements the ARIA combobox keyboard model', async () => {
    const f = TestBed.createComponent(Host);
    await f.whenStable();
    const input = f.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    const key = async (k: string) => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true }),
      );
      await f.whenStable();
    };
    await key('ArrowDown');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const active = () => input.getAttribute('aria-activedescendant');
    expect(
      f.nativeElement.querySelector(`#${active()}`)?.textContent,
    ).toContain('React');
    await key('ArrowDown');
    await key('ArrowDown'); // skips the disabled option
    expect(
      f.nativeElement.querySelector(`#${active()}`)?.textContent,
    ).toContain('Node');
    await key('Enter');
    expect(f.componentInstance.value).toBe('n');
    expect(input.value).toBe('Node');
    expect(input.getAttribute('aria-expanded')).toBe('false');

    input.value = 'ang';
    input.dispatchEvent(new Event('input'));
    await f.whenStable();
    expect(f.nativeElement.querySelectorAll('[role="option"]').length).toBe(1);
    await key('Escape');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('Select multiple', () => {
  @Component({
    imports: [Select, FormsModule],
    template: `<cdf-select
      [options]="opts"
      [multiple]="true"
      ariaLabel="Cats"
      [(ngModel)]="value"
    />`,
  })
  class Host {
    opts = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
    ];
    value: string[] = ['c'];
  }

  it('toggles values in option order and exposes the disclosure state', async () => {
    const f = TestBed.createComponent(Host);
    await f.whenStable();
    const trigger = f.nativeElement.querySelector(
      'button',
    ) as HTMLButtonElement;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.click();
    await f.whenStable();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const boxes = f.nativeElement.querySelectorAll(
      'input[type=checkbox]',
    ) as NodeListOf<HTMLInputElement>;
    boxes[0].checked = true;
    boxes[0].dispatchEvent(new Event('change'));
    await f.whenStable();
    expect(f.componentInstance.value).toEqual(['a', 'c']);
  });
});

describe('Pagination cursor mode', () => {
  it('emits the right cursor and disables at the ends', async () => {
    const f = TestBed.createComponent(Pagination);
    f.componentRef.setInput('mode', 'cursor');
    f.componentRef.setInput('prevCursor', null);
    f.componentRef.setInput('nextCursor', 'c2');
    const events: unknown[] = [];
    f.componentInstance.cursorChange.subscribe((e) => events.push(e));
    await f.whenStable();
    const [prev, next] = Array.from(
      f.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    expect(prev.disabled).toBe(true);
    next.click();
    expect(events).toEqual([{ direction: 'next', cursor: 'c2' }]);
  });
});

describe('Drawer', () => {
  @Component({
    imports: [Drawer],
    template: `<button id="opener" (click)="open.set(true)">open</button>
      <cdf-drawer [(open)]="open" title="Edit"
        ><input id="field"
      /></cdf-drawer>`,
  })
  class Host {
    readonly open = signal(false);
  }

  it('is a labelled modal dialog that closes on Esc', async () => {
    const f = TestBed.createComponent(Host);
    f.componentInstance.open.set(true);
    await f.whenStable();
    const dialog = f.nativeElement.querySelector(
      '[role="dialog"]',
    ) as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby')!;
    expect(f.nativeElement.querySelector(`#${labelledBy}`)?.textContent).toBe(
      'Edit',
    );
    dialog.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await f.whenStable();
    expect(f.componentInstance.open()).toBe(false);
    expect(f.nativeElement.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('DataTable select-all', () => {
  it('names the select-all and row checkboxes', async () => {
    const f = TestBed.createComponent(DataTable<{ id: number; name: string }>);
    f.componentRef.setInput('rows', [
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
    ]);
    f.componentRef.setInput('columns', [
      { key: 'name', label: 'Name', value: (r: { name: string }) => r.name },
    ]);
    f.componentRef.setInput('trackBy', (r: { id: number }) => r.id);
    f.componentRef.setInput('selectable', true);
    await f.whenStable();
    const boxes = Array.from(
      f.nativeElement.querySelectorAll('input[type=checkbox]'),
    ) as HTMLInputElement[];
    expect(boxes[0].getAttribute('aria-label')).toBe(
      'Selecionar todas as linhas',
    );
    expect(boxes[1].getAttribute('aria-label')).toBe('Selecionar linha 1');
  });
});

describe('CategoryAssignmentMatrix', () => {
  it('checks cells and select-all per plan', async () => {
    const f = TestBed.createComponent(CategoryAssignmentMatrix);
    f.componentRef.setInput('plans', [{ id: 'p', name: 'Pro' }]);
    f.componentRef.setInput('categories', [
      { id: 'a', name: 'Web' },
      { id: 'b', name: 'AI' },
    ]);
    f.componentRef.setInput('value', { p: ['b'] });
    await f.whenStable();
    const cells = f.nativeElement.querySelectorAll(
      'td input[type=checkbox]',
    ) as NodeListOf<HTMLInputElement>;
    expect(cells[0].getAttribute('aria-label')).toBe(
      'Incluir Web no plano Pro',
    );
    expect(cells[1].checked).toBe(true);
    const all = f.nativeElement.querySelector(
      'th input[type=checkbox]',
    ) as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    all.checked = true;
    all.dispatchEvent(new Event('change'));
    await f.whenStable();
    expect(f.componentInstance.value()).toEqual({ p: ['a', 'b'] });
  });
});
