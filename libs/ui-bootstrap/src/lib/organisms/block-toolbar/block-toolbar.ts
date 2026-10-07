import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { CalloutKind } from '@codify/lesson-schema';
import { EditorIcon, type EditorIconName } from './editor-icon.js';

/** Every command the lesson editor toolbar can issue. */
export type BlockToolbarCommand =
  | 'undo'
  | 'redo'
  | 'paragraph'
  | 'h2'
  | 'h3'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'code'
  | 'highlight'
  | 'kbd'
  | 'link'
  | 'bulletList'
  | 'orderedList'
  | 'blockquote'
  | 'codeBlock'
  | 'callout'
  | 'divider'
  | 'image'
  | 'embed'
  | 'table'
  | 'quiz'
  | 'insert'
  | 'addRowAfter'
  | 'addColumnAfter'
  | 'deleteRow'
  | 'deleteColumn'
  | 'toggleHeaderRow'
  | 'deleteTable';

export interface BlockToolbarItem {
  command: BlockToolbarCommand;
  label: string;
  icon: EditorIconName;
  /** Toggle buttons expose `aria-pressed`. */
  toggle: boolean;
  /** Keyboard shortcut in Tiptap notation (`Mod-Shift-b`). */
  shortcut?: string;
  group: 'history' | 'text' | 'marks' | 'blocks' | 'insert' | 'table';
}

/** Selection-dependent state the editor feeds in. */
export interface BlockToolbarState {
  /** Which toggle commands are currently active. */
  active: Partial<Record<BlockToolbarCommand, boolean>>;
  /** Commands that cannot run right now (e.g. undo with empty history). */
  disabled?: Partial<Record<BlockToolbarCommand, boolean>>;
  /** Cursor is inside a table → table commands are shown. */
  inTable?: boolean;
  /** Kind of the callout around the cursor, or null outside callouts. */
  calloutKind?: CalloutKind | null;
}

export const BLOCK_TOOLBAR_ITEMS: readonly BlockToolbarItem[] = [
  {
    command: 'undo',
    label: 'Undo',
    icon: 'ArrowCounterClockwise',
    toggle: false,
    shortcut: 'Mod-z',
    group: 'history',
  },
  {
    command: 'redo',
    label: 'Redo',
    icon: 'ArrowClockwise',
    toggle: false,
    shortcut: 'Mod-Shift-z',
    group: 'history',
  },
  {
    command: 'paragraph',
    label: 'Paragraph',
    icon: 'Paragraph',
    toggle: true,
    shortcut: 'Mod-Alt-0',
    group: 'text',
  },
  {
    command: 'h2',
    label: 'Heading 2',
    icon: 'TextHTwo',
    toggle: true,
    shortcut: 'Mod-Alt-2',
    group: 'text',
  },
  {
    command: 'h3',
    label: 'Heading 3',
    icon: 'TextHThree',
    toggle: true,
    shortcut: 'Mod-Alt-3',
    group: 'text',
  },
  {
    command: 'bold',
    label: 'Bold',
    icon: 'TextB',
    toggle: true,
    shortcut: 'Mod-b',
    group: 'marks',
  },
  {
    command: 'italic',
    label: 'Italic',
    icon: 'TextItalic',
    toggle: true,
    shortcut: 'Mod-i',
    group: 'marks',
  },
  {
    command: 'underline',
    label: 'Underline',
    icon: 'TextUnderline',
    toggle: true,
    shortcut: 'Mod-u',
    group: 'marks',
  },
  {
    command: 'strike',
    label: 'Strikethrough',
    icon: 'TextStrikethrough',
    toggle: true,
    shortcut: 'Mod-Shift-s',
    group: 'marks',
  },
  {
    command: 'code',
    label: 'Inline code',
    icon: 'Code',
    toggle: true,
    shortcut: 'Mod-e',
    group: 'marks',
  },
  {
    command: 'highlight',
    label: 'Highlight',
    icon: 'Highlighter',
    toggle: true,
    shortcut: 'Mod-Shift-h',
    group: 'marks',
  },
  {
    command: 'kbd',
    label: 'Keyboard key',
    icon: 'Keyboard',
    toggle: true,
    shortcut: 'Mod-Alt-k',
    group: 'marks',
  },
  {
    command: 'link',
    label: 'Link',
    icon: 'Link',
    toggle: true,
    shortcut: 'Mod-k',
    group: 'marks',
  },
  {
    command: 'bulletList',
    label: 'Bulleted list',
    icon: 'ListBullets',
    toggle: true,
    shortcut: 'Mod-Shift-8',
    group: 'blocks',
  },
  {
    command: 'orderedList',
    label: 'Numbered list',
    icon: 'ListNumbers',
    toggle: true,
    shortcut: 'Mod-Shift-7',
    group: 'blocks',
  },
  {
    command: 'blockquote',
    label: 'Quote',
    icon: 'Quotes',
    toggle: true,
    shortcut: 'Mod-Shift-b',
    group: 'blocks',
  },
  {
    command: 'codeBlock',
    label: 'Code block',
    icon: 'CodeBlock',
    toggle: true,
    shortcut: 'Mod-Alt-c',
    group: 'blocks',
  },
  {
    command: 'callout',
    label: 'Callout',
    icon: 'Info',
    toggle: true,
    group: 'blocks',
  },
  {
    command: 'divider',
    label: 'Divider',
    icon: 'Minus',
    toggle: false,
    group: 'insert',
  },
  {
    command: 'image',
    label: 'Image',
    icon: 'Image',
    toggle: false,
    group: 'insert',
  },
  {
    command: 'embed',
    label: 'Embed',
    icon: 'FrameCorners',
    toggle: false,
    group: 'insert',
  },
  {
    command: 'table',
    label: 'Table',
    icon: 'Table',
    toggle: false,
    group: 'insert',
  },
  {
    command: 'quiz',
    label: 'Quiz',
    icon: 'ListChecks',
    toggle: false,
    group: 'insert',
  },
  {
    command: 'insert',
    label: 'Insert block…',
    icon: 'Plus',
    toggle: false,
    shortcut: 'Mod-/',
    group: 'insert',
  },
  {
    command: 'addRowAfter',
    label: 'Add row below',
    icon: 'RowsPlusBottom',
    toggle: false,
    group: 'table',
  },
  {
    command: 'addColumnAfter',
    label: 'Add column right',
    icon: 'ColumnsPlusRight',
    toggle: false,
    group: 'table',
  },
  {
    command: 'deleteRow',
    label: 'Delete row',
    icon: 'MinusSquare',
    toggle: false,
    group: 'table',
  },
  {
    command: 'deleteColumn',
    label: 'Delete column',
    icon: 'XSquare',
    toggle: false,
    group: 'table',
  },
  {
    command: 'toggleHeaderRow',
    label: 'Toggle header row',
    icon: 'SquareHalf',
    toggle: false,
    group: 'table',
  },
  {
    command: 'deleteTable',
    label: 'Delete table',
    icon: 'Trash',
    toggle: false,
    group: 'table',
  },
];

const CALLOUT_KINDS: { kind: CalloutKind; label: string }[] = [
  { kind: 'info', label: 'Info' },
  { kind: 'tip', label: 'Tip' },
  { kind: 'warn', label: 'Warning' },
  { kind: 'danger', label: 'Danger' },
  { kind: 'success', label: 'Success' },
];

function isMac(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.platform ?? '')
  );
}

/** `Mod-Shift-b` → human label (`Ctrl+Shift+B` / `⌘⇧B`). */
export function formatShortcut(shortcut: string, mac = isMac()): string {
  const parts = shortcut.split('-');
  const key = parts.pop() ?? '';
  const mods = parts.map((m) => {
    if (m === 'Mod') return mac ? '⌘' : 'Ctrl';
    if (m === 'Shift') return mac ? '⇧' : 'Shift';
    if (m === 'Alt') return mac ? '⌥' : 'Alt';
    return m;
  });
  const k = key.length === 1 ? key.toUpperCase() : key;
  return mac ? [...mods, k].join('') : [...mods, k].join('+');
}

/** `Mod-Shift-b` → `aria-keyshortcuts` value (`Control+Shift+B Meta+Shift+B`). */
export function ariaShortcut(shortcut: string): string {
  const parts = shortcut.split('-');
  const key = (parts.pop() ?? '').toUpperCase();
  const mods = parts.filter((m) => m !== 'Mod');
  const hasMod = parts.includes('Mod');
  const build = (primary: string | null) =>
    [...(primary ? [primary] : []), ...mods, key].join('+');
  return hasMod ? `${build('Control')} ${build('Meta')}` : build(null);
}

/**
 * Lesson editor toolbar (WAI-ARIA toolbar pattern). Presentational: it
 * renders `BLOCK_TOOLBAR_ITEMS` with one distinct glyph per command,
 * `aria-pressed` on toggles, `aria-keyshortcuts` + tooltips for shortcuts,
 * and roving focus (←/→/Home/End). The editor owns the actual commands.
 *
 *   <cdf-block-toolbar [state]="state()" (toolbarCommand)="run($event)" />
 */
@Component({
  selector: 'cdf-block-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EditorIcon],
  templateUrl: './block-toolbar.html',
  styleUrl: './block-toolbar.scss',
  host: {
    role: 'toolbar',
    '[attr.aria-label]': 'label()',
    '[attr.aria-disabled]': 'disabled() || null',
    '(keydown)': 'onKeydown($event)',
  },
})
export class BlockToolbar {
  readonly state = input<BlockToolbarState>({ active: {} });
  readonly disabled = input(false);
  readonly label = input('Lesson editor formatting');

  readonly toolbarCommand = output<BlockToolbarCommand>();
  readonly calloutKindChange = output<CalloutKind>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Index (among focusable controls) that holds tabindex=0. */
  protected readonly focusIndex = signal(0);
  protected readonly calloutKinds = CALLOUT_KINDS;

  protected readonly groups = computed(() => {
    const inTable = this.state().inTable ?? false;
    const order: BlockToolbarItem['group'][] = [
      'history',
      'text',
      'marks',
      'blocks',
      'insert',
      'table',
    ];
    return order
      .filter((g) => g !== 'table' || inTable)
      .map((g) => ({
        name: g,
        items: BLOCK_TOOLBAR_ITEMS.filter((i) => i.group === g),
      }));
  });

  /** Flat list used for roving tabindex. */
  protected readonly flat = computed(() =>
    this.groups().flatMap((g) => g.items),
  );

  protected isActive(cmd: BlockToolbarCommand): boolean {
    return this.state().active[cmd] ?? false;
  }

  protected isDisabled(cmd: BlockToolbarCommand): boolean {
    return this.disabled() || (this.state().disabled?.[cmd] ?? false);
  }

  protected tooltip(item: BlockToolbarItem): string {
    return item.shortcut
      ? `${item.label} (${formatShortcut(item.shortcut)})`
      : item.label;
  }

  protected aria(item: BlockToolbarItem): string | null {
    return item.shortcut ? ariaShortcut(item.shortcut) : null;
  }

  protected tabIndexFor(item: BlockToolbarItem): number {
    return this.flat().indexOf(item) === this.focusIndex() ? 0 : -1;
  }

  protected run(item: BlockToolbarItem): void {
    this.focusIndex.set(this.flat().indexOf(item));
    if (this.isDisabled(item.command)) return;
    this.toolbarCommand.emit(item.command);
  }

  protected onCalloutKind(event: Event): void {
    const kind = (event.target as HTMLSelectElement).value as CalloutKind;
    this.calloutKindChange.emit(kind);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'SELECT') return;
    const buttons = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLButtonElement>(
        'button[data-toolbar-item]',
      ),
    );
    if (!buttons.length) return;
    const current = Math.max(0, buttons.indexOf(target as HTMLButtonElement));
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % buttons.length;
    if (event.key === 'ArrowLeft')
      next = (current - 1 + buttons.length) % buttons.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    event.preventDefault();
    this.focusIndex.set(next);
    buttons[next].focus();
  }
}
