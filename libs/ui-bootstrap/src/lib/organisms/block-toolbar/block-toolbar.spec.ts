import { TestBed } from '@angular/core/testing';
import {
  BlockToolbar,
  BLOCK_TOOLBAR_ITEMS,
  ariaShortcut,
  formatShortcut,
  type BlockToolbarCommand,
} from './block-toolbar.js';

async function mount(
  state: BlockToolbar['state'] extends () => infer S ? S : never,
) {
  await TestBed.configureTestingModule({
    imports: [BlockToolbar],
  }).compileComponents();
  const fixture = TestBed.createComponent(BlockToolbar);
  fixture.componentRef.setInput('state', state);
  fixture.detectChanges();
  await fixture.whenStable();
  const emitted: BlockToolbarCommand[] = [];
  fixture.componentInstance.toolbarCommand.subscribe((c) => emitted.push(c));
  return { fixture, el: fixture.nativeElement as HTMLElement, emitted };
}

describe('BlockToolbar', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('uses one distinct glyph per command', () => {
    const icons = BLOCK_TOOLBAR_ITEMS.map((i) => i.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('exposes aria-pressed only on toggles and reflects state', async () => {
    const { el } = await mount({ active: { bold: true } });
    const bold = el.querySelector('[data-command="bold"]');
    expect(bold?.getAttribute('aria-pressed')).toBe('true');
    expect(
      el.querySelector('[data-command="italic"]')?.getAttribute('aria-pressed'),
    ).toBe('false');
    expect(
      el
        .querySelector('[data-command="divider"]')
        ?.hasAttribute('aria-pressed'),
    ).toBe(false);
    expect(el.getAttribute('role')).toBe('toolbar');
  });

  it('emits commands, but not for disabled ones', async () => {
    const { el, emitted } = await mount({
      active: {},
      disabled: { undo: true },
    });
    el.querySelector<HTMLButtonElement>('[data-command="undo"]')!.click();
    el.querySelector<HTMLButtonElement>('[data-command="italic"]')!.click();
    expect(emitted).toEqual(['italic']);
    expect(
      el.querySelector('[data-command="undo"]')?.getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('shows table tools only inside tables and a callout style picker inside callouts', async () => {
    const { el, fixture } = await mount({ active: {} });
    expect(el.querySelector('[data-command="addRowAfter"]')).toBeNull();
    expect(el.querySelector('select')).toBeNull();
    fixture.componentRef.setInput('state', {
      active: {},
      inTable: true,
      calloutKind: 'warn',
    });
    fixture.detectChanges();
    expect(el.querySelector('[data-command="addRowAfter"]')).toBeTruthy();
    expect(el.querySelector<HTMLSelectElement>('select')?.value).toBe('warn');
  });

  it('implements roving focus with arrow keys', async () => {
    const { el, fixture } = await mount({ active: {} });
    const buttons = Array.from(
      el.querySelectorAll<HTMLButtonElement>('button[data-toolbar-item]'),
    );
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    buttons[0].focus();
    buttons[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    fixture.detectChanges();
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons[1].tabIndex).toBe(0);
    buttons[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    );
    fixture.detectChanges();
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it('formats shortcuts for both platforms', () => {
    expect(formatShortcut('Mod-Shift-b', false)).toBe('Ctrl+Shift+B');
    expect(formatShortcut('Mod-Shift-b', true)).toBe('⌘⇧B');
    expect(ariaShortcut('Mod-Alt-2')).toBe('Control+Alt+2 Meta+Alt+2');
  });
});
