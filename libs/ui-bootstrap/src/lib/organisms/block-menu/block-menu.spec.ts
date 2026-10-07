import { TestBed } from '@angular/core/testing';
import { BlockMenu, blockMenuItemsFromRegistry } from './block-menu.js';

async function mount() {
  await TestBed.configureTestingModule({
    imports: [BlockMenu],
  }).compileComponents();
  const fixture = TestBed.createComponent(BlockMenu);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const picked: string[] = [];
  let dismissed = 0;
  fixture.componentInstance.pick.subscribe((t) => picked.push(t));
  fixture.componentInstance.dismiss.subscribe(() => dismissed++);
  const el = fixture.nativeElement as HTMLElement;
  const input = el.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  const key = (k: string) => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true }),
    );
    fixture.detectChanges();
  };
  return { fixture, el, input, picked, key, dismissed: () => dismissed };
}

describe('BlockMenu', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists insertable registry blocks with unique icons', () => {
    const items = blockMenuItemsFromRegistry();
    expect(items.map((i) => i.type)).toEqual(
      expect.arrayContaining([
        'image',
        'embed',
        'table',
        'quiz',
        'exerciseRef',
        'aiPromptRef',
        'scenarioRef',
      ]),
    );
    expect(items.some((i) => i.type === 'listItem')).toBe(false);
    expect(new Set(items.map((i) => i.icon)).size).toBe(items.length);
  });

  it('focuses the filter and wires combobox → listbox semantics', async () => {
    const { el, input } = await mount();
    expect(document.activeElement).toBe(input);
    const list = el.querySelector('[role="listbox"]')!;
    expect(input.getAttribute('aria-controls')).toBe(list.id);
    expect(input.getAttribute('aria-activedescendant')).toBe(
      el.querySelector('[role="option"][aria-selected="true"]')!.id,
    );
  });

  it('filters by label / keyword and picks with Enter', async () => {
    const { input, key, picked, fixture, el } = await mount();
    input.value = 'youtube';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(
      Array.from(el.querySelectorAll('[role="option"]')).map((o) =>
        o.getAttribute('data-type'),
      ),
    ).toEqual(['embed']);
    key('Enter');
    expect(picked).toEqual(['embed']);
  });

  it('moves the active option with arrows and dismisses on Escape', async () => {
    const { key, el, dismissed } = await mount();
    key('ArrowDown');
    const active = el.querySelector('[role="option"][aria-selected="true"]');
    expect(active).toBe(el.querySelectorAll('[role="option"]')[1]);
    key('ArrowUp');
    key('ArrowUp');
    expect(el.querySelector('[role="option"][aria-selected="true"]')).toBe(
      Array.from(el.querySelectorAll('[role="option"]')).at(-1),
    );
    key('Escape');
    expect(dismissed()).toBe(1);
  });

  it('shows an empty state when nothing matches', async () => {
    const { input, fixture, el } = await mount();
    input.value = 'zzzz';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.textContent).toContain('No matching blocks');
  });
});
