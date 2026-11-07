import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  insertableBlocks,
  type BlockRegistryEntry,
} from '@codify/lesson-schema';
import { EditorIcon } from '../block-toolbar/editor-icon.js';

export interface BlockMenuItem {
  type: string;
  label: string;
  description: string;
  icon: string;
  group?: string;
  keywords?: readonly string[];
}

/** Insertable blocks from the lesson registry, shaped for the menu. */
export function blockMenuItemsFromRegistry(
  entries: readonly BlockRegistryEntry[] = insertableBlocks(),
): BlockMenuItem[] {
  return entries.map((e) => ({
    type: e.type,
    label: e.label,
    description: e.description,
    icon: e.icon,
    group: e.group,
    keywords: e.keywords,
  }));
}

let nextId = 0;

/**
 * Slash / insert menu (combobox + listbox pattern). The filter input keeps
 * focus; ↑/↓ move the active option, Enter picks, Escape dismisses.
 *
 *   @if (open) { <cdf-block-menu (pick)="insert($event)" (dismiss)="close()" /> }
 */
@Component({
  selector: 'cdf-block-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EditorIcon],
  templateUrl: './block-menu.html',
  styleUrl: './block-menu.scss',
})
export class BlockMenu {
  readonly items = input<BlockMenuItem[]>(blockMenuItemsFromRegistry());
  readonly label = input('Insert block');
  /** Initial filter text (e.g. what was typed after `/`). */
  readonly initialQuery = input('');

  readonly pick = output<string>();
  readonly dismiss = output<void>();

  protected readonly id = `cdf-block-menu-${nextId++}`;
  protected readonly query = signal('');
  protected readonly active = signal(0);
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.items();
    return this.items().filter((i) =>
      [i.label, i.description, i.type, ...(i.keywords ?? [])].some((s) =>
        s.toLowerCase().includes(q),
      ),
    );
  });

  protected readonly activeId = computed(() => {
    const item = this.filtered()[this.active()];
    return item ? `${this.id}-opt-${item.type}` : null;
  });

  constructor() {
    afterNextRender(() => {
      this.query.set(this.initialQuery());
      this.search()?.nativeElement.focus();
    });
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.active.set(0);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.filtered().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (count) this.active.set((this.active() + 1) % count);
        this.scrollActive();
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (count) this.active.set((this.active() - 1 + count) % count);
        this.scrollActive();
        break;
      case 'Home':
        event.preventDefault();
        this.active.set(0);
        break;
      case 'End':
        event.preventDefault();
        this.active.set(Math.max(0, count - 1));
        break;
      case 'Enter': {
        event.preventDefault();
        const item = this.filtered()[this.active()];
        if (item) this.pick.emit(item.type);
        break;
      }
      case 'Escape':
      case 'Tab':
        event.preventDefault();
        this.dismiss.emit();
        break;
      default:
        break;
    }
  }

  protected choose(item: BlockMenuItem): void {
    this.pick.emit(item.type);
  }

  private scrollActive(): void {
    const id = this.activeId();
    if (!id) return;
    const el = this.host.nativeElement.ownerDocument.getElementById(id);
    el?.scrollIntoView?.({ block: 'nearest' });
  }
}
