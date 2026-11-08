import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  EnvironmentInjector,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  signal,
  viewChild,
  OnDestroy,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { I18nService } from '@codify/i18n';
// Side-effect imports — bring in the chained-command type augmentations
// from each Tiptap extension so editor.chain().toggleHeading() etc. type-check.
import '@tiptap/starter-kit';
import '@tiptap/extension-link';
import {
  emptyLessonDoc,
  LESSON_DOC_VERSION,
  type CalloutKind,
  type LessonDoc,
} from '@codify/lesson-schema';
import { buildLessonExtensions } from './tiptap/extensions.js';
import { angularNodeView } from './tiptap/angular-node-view.js';
import {
  isInTable,
  newQuizAttrs,
  structureSignature,
  topBlockAt,
} from './tiptap/lesson-nodes.js';
import { BlockProperties, type SelectedBlock } from './block-properties.js';
import { EditorIcon } from '../block-toolbar/editor-icon.js';
import { TranslatePipe } from '@codify/i18n';
import { QuizBlockView } from './node-views/quiz-block-view.js';
import { RefBlockView } from './node-views/ref-block-view.js';
import {
  EmbedBlockView,
  ImageBlockView,
  VideoBlockView,
} from './node-views/media-block-views.js';
import {
  EmbedPanel,
  ImagePanel,
  LinkPanel,
  type EmbedPanelResult,
  type ImagePanelResult,
  type LinkPanelResult,
} from './editor-panels.js';
import {
  BlockToolbar,
  type BlockToolbarCommand,
  type BlockToolbarState,
} from '../block-toolbar/block-toolbar.js';
import { BlockMenu } from '../block-menu/block-menu.js';

type Panel = 'link' | 'image' | 'embed' | null;

interface MenuState {
  top: number;
  left: number;
}

/** An outline entry (docs/06 §9 outline view). */
export interface OutlineItem {
  pos: number;
  type: string;
  /** Heading level (2/3); 0 for other blocks. */
  level: number;
  label: string;
}

const OUTLINE_TYPES = new Set([
  'heading',
  'quiz',
  'exerciseRef',
  'aiPromptRef',
  'scenarioRef',
  'embed',
  'videoBlock',
  'table',
  'codeBlock',
  'image',
]);

/** Marks offered by the floating selection toolbar. */
const BUBBLE_MARKS = [
  { cmd: 'bold', icon: 'TextB' },
  { cmd: 'italic', icon: 'TextItalic' },
  { cmd: 'strike', icon: 'TextStrikethrough' },
  { cmd: 'code', icon: 'Code' },
  { cmd: 'highlight', icon: 'Highlighter' },
  { cmd: 'link', icon: 'Link' },
] as const;
type BubbleMark = (typeof BUBBLE_MARKS)[number]['cmd'];

/**
 * Tiptap-backed lesson editor.
 *
 * Two-way bindable as a form control: writes/emits a `LessonDoc` JSON value
 * that validates against `lessonDocSchema`.
 *
 *   <cdf-lesson-block-editor [(ngModel)]="doc" />
 *
 * Covers every block in the lesson schema: text structure, callouts,
 * images (uploaded via `LESSON_ASSET_UPLOADER` or by URL), allowlisted
 * embeds, tables, quizzes and exercise / AI-prompt / scenario refs. The
 * toolbar is `cdf-block-toolbar`; `/` in an empty paragraph or Mod-/
 * opens `cdf-block-menu`; Mod-K opens the inline link dialog.
 */
@Component({
  selector: 'cdf-lesson-block-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BlockToolbar,
    BlockMenu,
    LinkPanel,
    ImagePanel,
    EmbedPanel,
    BlockProperties,
    EditorIcon,
    TranslatePipe,
  ],
  templateUrl: './lesson-block-editor.html',
  styleUrl: './lesson-block-editor.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => LessonBlockEditor),
      multi: true,
    },
  ],
})
export class LessonBlockEditor implements ControlValueAccessor, OnDestroy {
  /** Empty-document hint; defaults to `ui.lessonEditor.placeholder`. */
  readonly placeholder = input<string>();
  readonly readonly = input(false);
  /**
   * Translation mode (docs/11 §3): text is editable, but blocks can't be
   * added, removed, reordered or have their behavioural attrs changed.
   */
  readonly lockStructure = input(false);
  /** Show the right-side block properties panel (docs/06 §9). */
  readonly showProperties = input(true);

  private readonly hostEl = inject(ElementRef<HTMLElement>);
  private readonly i18n = inject(I18nService);
  private readonly injector = inject(EnvironmentInjector);
  private readonly editorContainer =
    viewChild.required<ElementRef<HTMLElement>>('editorHost');

  /** Current editor selection state — drives toolbar active highlights. */
  protected readonly state = signal<EditorSelectionState>(
    emptySelectionState(),
  );
  protected readonly panel = signal<Panel>(null);
  protected readonly menu = signal<MenuState | null>(null);
  protected readonly link = signal({ href: '', newTab: false, hasLink: false });
  protected readonly announcement = signal('');
  private readonly disabledByForm = signal(false);
  /** Outline (heading + interactive block tree) toggle. */
  protected readonly outlineOpen = signal(false);
  protected readonly propertiesOpen = signal(true);
  protected readonly outline = signal<OutlineItem[]>([]);
  protected readonly selectedBlock = signal<SelectedBlock | null>(null);
  /** Floating marks toolbar position (null = hidden). */
  protected readonly bubble = signal<{ top: number; left: number } | null>(
    null,
  );
  protected readonly bubbleMarks = BUBBLE_MARKS;
  /** Drag handle position + the block it moves. */
  protected readonly handle = signal<{ top: number; pos: number } | null>(null);
  private readonly bubbleEl = viewChild<ElementRef<HTMLElement>>('bubbleEl');
  private readonly bodyEl = viewChild<ElementRef<HTMLElement>>('bodyEl');

  protected readonly isReadonly = computed(
    () => this.readonly() || this.disabledByForm(),
  );

  protected readonly toolbarState = computed<BlockToolbarState>(() => {
    const s = this.state();
    return {
      active: {
        paragraph: s.paragraph && !s.h2 && !s.h3,
        h2: s.h2,
        h3: s.h3,
        bold: s.bold,
        italic: s.italic,
        underline: s.underline,
        strike: s.strike,
        code: s.code,
        highlight: s.highlight,
        kbd: s.kbd,
        link: s.link,
        bulletList: s.bulletList,
        orderedList: s.orderedList,
        blockquote: s.blockquote,
        codeBlock: s.codeBlock,
        callout: s.callout,
      },
      disabled: { undo: !s.canUndo, redo: !s.canRedo },
      inTable: s.inTable,
      calloutKind: s.calloutKind,
    };
  });

  private editor: Editor | null = null;
  /** Last value pushed in via writeValue but not yet applied (editor not built). */
  private pendingValue: LessonDoc | null = null;
  /** Suppress emit when we set content programmatically (writeValue). */
  private suppressEmit = false;

  private onChangeFn: (v: LessonDoc) => void = () => undefined;
  private onTouchedFn: () => void = () => undefined;

  constructor() {
    // Initialize editor after the view is set up.
    effect(() => {
      const host = this.editorContainer().nativeElement;
      if (this.editor) return;
      const nodeHost = {
        injector: this.injector,
        structureLocked: () => this.lockStructure(),
      };
      this.editor = new Editor({
        element: host,
        extensions: buildLessonExtensions({
          placeholder:
            this.placeholder() ?? this.i18n.t('ui.lessonEditor.placeholder'),
          nodeViews: {
            quiz: angularNodeView(QuizBlockView, nodeHost),
            exerciseRef: angularNodeView(RefBlockView, nodeHost),
            aiPromptRef: angularNodeView(RefBlockView, nodeHost),
            scenarioRef: angularNodeView(RefBlockView, nodeHost),
            image: angularNodeView(ImageBlockView, nodeHost),
            embed: angularNodeView(EmbedBlockView, nodeHost),
            videoBlock: angularNodeView(VideoBlockView, nodeHost),
          },
          onOpenLink: () => this.openLinkPanel(),
          onOpenBlockMenu: () => this.openMenu(),
          structureLocked: () => this.lockStructure(),
          onFocusMarksToolbar: () => this.focusBubble(),
        }),
        editable: !this.isReadonly(),
        content: (this.pendingValue ?? emptyLessonDoc()) as unknown as Record<
          string,
          unknown
        >,
        editorProps: {
          attributes: {
            role: 'textbox',
            'aria-multiline': 'true',
            'aria-label': this.i18n.t('ui.lessonEditor.contentLabel'),
          },
        },
        onUpdate: ({ editor }) => {
          this.refreshState();
          if (this.suppressEmit) return;
          this.onChangeFn(this.currentDoc(editor));
        },
        onSelectionUpdate: () => this.refreshState(),
        onFocus: () => this.refreshState(),
        onBlur: ({ event }) => {
          this.onTouchedFn();
          // Keep the bubble while focus moves into it.
          const next = (event as FocusEvent).relatedTarget as Node | null;
          if (!next || !this.bubbleEl()?.nativeElement.contains(next))
            this.bubble.set(null);
        },
      });
      this.refreshState();
    });

    // React to readonly / disabled changes
    effect(() => {
      const ro = this.isReadonly();
      this.editor?.setEditable(!ro);
    });
  }

  ngOnDestroy(): void {
    this.editor?.destroy();
    this.editor = null;
  }

  // ─── ControlValueAccessor ────────────────────────────────────────────────
  writeValue(value: LessonDoc | null | undefined): void {
    const doc = value ?? emptyLessonDoc();
    if (!this.editor) {
      this.pendingValue = doc;
      return;
    }
    this.suppressEmit = true;
    try {
      // Loading a doc is never a structural "edit" (translation lock).
      this.editor
        .chain()
        .command(({ tr }) => {
          tr.setMeta('lessonStructureLockBypass', true);
          return true;
        })
        .setContent(doc as unknown as Record<string, unknown>)
        .run();
      this.refreshState();
    } finally {
      this.suppressEmit = false;
    }
  }
  registerOnChange(fn: (v: LessonDoc) => void): void {
    this.onChangeFn = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouchedFn = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabledByForm.set(isDisabled);
  }

  /** Current doc (tests, parents holding a ViewChild). */
  getDoc(): LessonDoc | null {
    return this.editor ? this.currentDoc(this.editor) : null;
  }

  /** Underlying Tiptap editor (tests / advanced integrations). */
  get tiptap(): Editor | null {
    return this.editor;
  }

  // ─── Toolbar ─────────────────────────────────────────────────────────────
  protected runCommand(cmd: BlockToolbarCommand): void {
    const editor = this.editor;
    if (!editor) return;
    if (this.lockStructure() && STRUCTURAL_COMMANDS.has(cmd)) {
      this.announce('ui.lessonEditor.announce.locked');
      return;
    }
    const chain = () => editor.chain().focus();
    switch (cmd) {
      case 'undo':
        chain().undo().run();
        break;
      case 'redo':
        chain().redo().run();
        break;
      case 'paragraph':
        chain().setParagraph().run();
        break;
      case 'h2':
        chain().toggleHeading({ level: 2 }).run();
        break;
      case 'h3':
        chain().toggleHeading({ level: 3 }).run();
        break;
      case 'bold':
      case 'italic':
      case 'underline':
      case 'strike':
      case 'code':
      case 'highlight':
      case 'kbd':
        chain().toggleMark(cmd).run();
        break;
      case 'link':
        this.openLinkPanel();
        break;
      case 'bulletList':
        chain().toggleBulletList().run();
        break;
      case 'orderedList':
        chain().toggleOrderedList().run();
        break;
      case 'blockquote':
        chain().toggleBlockquote().run();
        break;
      case 'codeBlock':
        chain().toggleCodeBlock().run();
        break;
      case 'callout':
        if (!chain().toggleCallout('info').run()) {
          this.announce('ui.lessonEditor.announce.calloutTopLevel');
        }
        break;
      case 'divider':
        chain().setHorizontalRule().run();
        break;
      case 'image':
        this.panel.set('image');
        break;
      case 'embed':
        this.panel.set('embed');
        break;
      case 'table':
        chain().insertLessonTable().run();
        break;
      case 'quiz':
        chain()
          .insertRootBlock({ type: 'quiz', attrs: { ...newQuizAttrs() } })
          .run();
        this.announce('ui.lessonEditor.announce.quizInserted');
        break;
      case 'insert':
        this.openMenu();
        break;
      case 'addRowAfter':
      case 'addColumnAfter':
      case 'deleteRow':
      case 'deleteColumn':
      case 'toggleHeaderRow':
      case 'deleteTable':
        chain().lessonTableCommand(cmd).run();
        break;
    }
    this.refreshState();
  }

  protected setCalloutKind(kind: CalloutKind): void {
    this.editor?.chain().focus().setCalloutKind(kind).run();
  }

  // ─── Block menu ──────────────────────────────────────────────────────────
  protected openMenu(): void {
    const editor = this.editor;
    if (!editor || this.isReadonly()) return;
    if (this.lockStructure()) {
      this.announce('ui.lessonEditor.announce.locked');
      return;
    }
    let top = 0;
    let left = 0;
    try {
      const coords = editor.view.coordsAtPos(editor.state.selection.from);
      const box = this.editorContainer().nativeElement.getBoundingClientRect();
      top = coords.bottom - box.top + 4;
      left = Math.max(0, coords.left - box.left);
    } catch {
      // jsdom / detached views have no layout; fall back to the top-left.
    }
    this.panel.set(null);
    this.menu.set({ top, left });
  }

  protected closeMenu(): void {
    this.menu.set(null);
    this.editor?.commands.focus();
  }

  /** Insert a block chosen from the menu. */
  insertBlock(type: string): void {
    const editor = this.editor;
    this.menu.set(null);
    if (!editor) return;
    const chain = () => editor.chain().focus();
    switch (type) {
      case 'paragraph':
        chain().setParagraph().run();
        break;
      case 'heading':
        chain().setHeading({ level: 2 }).run();
        break;
      case 'bulletList':
        chain().toggleBulletList().run();
        break;
      case 'orderedList':
        chain().toggleOrderedList().run();
        break;
      case 'blockquote':
        chain().toggleBlockquote().run();
        break;
      case 'codeBlock':
        chain().setCodeBlock().run();
        break;
      case 'callout':
        if (!chain().setCallout('info').run()) {
          chain()
            .insertRootBlock({
              type: 'callout',
              attrs: { kind: 'info' },
              content: [{ type: 'paragraph' }],
            })
            .run();
        }
        break;
      case 'horizontalRule':
        chain().setHorizontalRule().run();
        break;
      case 'image':
        this.panel.set('image');
        return;
      case 'embed':
        this.panel.set('embed');
        return;
      case 'table':
        chain().insertLessonTable().run();
        break;
      case 'quiz':
        chain()
          .insertRootBlock({ type: 'quiz', attrs: { ...newQuizAttrs() } })
          .run();
        break;
      case 'exerciseRef':
        chain()
          .insertRootBlock({ type: 'exerciseRef', attrs: { exerciseId: '' } })
          .run();
        break;
      case 'aiPromptRef':
        chain()
          .insertRootBlock({ type: 'aiPromptRef', attrs: { aiPromptId: '' } })
          .run();
        break;
      case 'scenarioRef':
        chain()
          .insertRootBlock({ type: 'scenarioRef', attrs: { scenarioId: '' } })
          .run();
        break;
      case 'videoBlock':
        chain()
          .insertRootBlock({
            type: 'videoBlock',
            attrs: { title: this.i18n.t('ui.lessonEditor.video.defaultTitle') },
          })
          .run();
        this.announce('ui.lessonEditor.announce.videoInserted');
        this.refreshState();
        return;
      default:
        return;
    }
    this.announce('ui.lessonEditor.announce.blockInserted');
    this.refreshState();
  }

  // ─── Panels ──────────────────────────────────────────────────────────────
  protected openLinkPanel(): void {
    const editor = this.editor;
    if (!editor || this.isReadonly()) return;
    const attrs = editor.getAttributes('link');
    const href = (attrs['href'] as string | undefined) ?? '';
    this.link.set({
      href,
      newTab: attrs['target'] === '_blank',
      hasLink: editor.isActive('link'),
    });
    this.menu.set(null);
    this.panel.set('link');
  }

  protected applyLink(result: LinkPanelResult): void {
    const editor = this.editor;
    this.panel.set(null);
    if (!editor) return;
    const target = result.newTab ? '_blank' : null;
    if (editor.state.selection.empty && !editor.isActive('link')) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'text',
          text: result.href,
          marks: [{ type: 'link', attrs: { href: result.href, target } }],
        })
        .run();
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: result.href, target })
        .run();
    }
    this.refreshState();
  }

  protected removeLink(): void {
    this.panel.set(null);
    this.editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    this.refreshState();
  }

  protected insertImage(result: ImagePanelResult): void {
    this.panel.set(null);
    this.editor?.chain().focus().insertLessonImage(result).run();
    this.announce('ui.lessonEditor.announce.imageInserted');
  }

  protected insertEmbed(result: EmbedPanelResult): void {
    this.panel.set(null);
    this.editor
      ?.chain()
      .focus()
      .insertRootBlock({ type: 'embed', attrs: { ...result } })
      .run();
    this.announce('ui.lessonEditor.announce.embedInserted');
  }

  protected closePanel(): void {
    this.panel.set(null);
    this.editor?.commands.focus();
  }

  // ─── Floating marks toolbar ──────────────────────────────────────────────
  protected bubbleActive(cmd: BubbleMark): boolean {
    const s = this.state();
    return cmd === 'link' ? s.link : s[cmd];
  }

  protected applyBubble(cmd: BubbleMark): void {
    const editor = this.editor;
    if (!editor) return;
    if (cmd === 'link') {
      this.bubble.set(null);
      this.openLinkPanel();
      return;
    }
    editor.chain().focus().toggleMark(cmd).run();
    this.refreshState();
  }

  /** Alt+F10 from the text, ←/→ inside, Escape back to the text. */
  protected focusBubble(): void {
    queueMicrotask(() =>
      this.bubbleEl()
        ?.nativeElement.querySelector<HTMLElement>('button')
        ?.focus(),
    );
  }

  protected bubbleKeydown(event: KeyboardEvent): void {
    const buttons = Array.from(
      this.bubbleEl()?.nativeElement.querySelectorAll<HTMLElement>('button') ??
        [],
    );
    const i = buttons.indexOf(event.target as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      this.editor?.commands.focus();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const d = event.key === 'ArrowRight' ? 1 : -1;
      buttons[(i + d + buttons.length) % buttons.length]?.focus();
    }
  }

  private updateBubble(e: Editor): void {
    const sel = e.state.selection;
    // Shown for any non-empty text selection; hidden again on blur (unless
    // focus moved into the toolbar itself, see onBlur).
    const inBubble = !!this.bubbleEl()?.nativeElement.contains(
      document.activeElement,
    );
    if (
      this.isReadonly() ||
      sel.empty ||
      !(sel instanceof TextSelection) ||
      e.isActive('codeBlock')
    ) {
      if (!inBubble) this.bubble.set(null);
      return;
    }
    try {
      const start = e.view.coordsAtPos(sel.from);
      const end = e.view.coordsAtPos(sel.to);
      const box = this.bodyEl()?.nativeElement.getBoundingClientRect();
      if (!box) return;
      const top = Math.min(start.top, end.top) - box.top - 44;
      const left = Math.max(
        0,
        Math.min(start.left - box.left, Math.max(0, box.width - 260)),
      );
      this.bubble.set({ top: Math.max(0, top), left });
    } catch {
      this.bubble.set({ top: 0, left: 0 }); // jsdom: no layout
    }
  }

  // ─── Drag handle + block moves ───────────────────────────────────────────
  /** Track the top-level block under the pointer for the drag handle. */
  protected trackPointer(event: MouseEvent): void {
    const e = this.editor;
    if (!e || this.isReadonly() || this.lockStructure()) return;
    if ((event.target as HTMLElement)?.closest?.('.cdf-lesson-editor__handle'))
      return;
    const hit = e.view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!hit) return;
    this.placeHandle(e, hit.pos);
  }

  private placeHandle(e: Editor, pos: number): void {
    const top = topBlockAt(e.state.doc, pos);
    const body = this.bodyEl()?.nativeElement;
    if (!top || !body) return;
    const dom = e.view.nodeDOM(top.pos) as HTMLElement | null;
    if (!dom?.getBoundingClientRect) return;
    const y =
      dom.getBoundingClientRect().top - body.getBoundingClientRect().top;
    const cur = this.handle();
    if (!cur || cur.pos !== top.pos || cur.top !== y)
      this.handle.set({ top: y, pos: top.pos });
  }

  /** Native drag of the handle moves the whole block (ProseMirror drop). */
  protected startDrag(event: DragEvent): void {
    const e = this.editor;
    const h = this.handle();
    if (!e || !h || this.lockStructure()) return;
    const sel = NodeSelection.create(e.state.doc, h.pos);
    e.view.dispatch(e.state.tr.setSelection(sel));
    const dom = e.view.nodeDOM(h.pos) as HTMLElement | null;
    event.dataTransfer?.setData('text/plain', '');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    if (dom && event.dataTransfer?.setDragImage)
      event.dataTransfer.setDragImage(dom, 0, 0);
    // Same contract ProseMirror's own drag start uses.
    (e.view as unknown as { dragging: unknown }).dragging = {
      slice: sel.content(),
      move: true,
      node: sel,
    };
  }

  /** Click / Enter on the handle selects the block (then Alt+Shift+↑/↓). */
  protected selectHandleBlock(): void {
    const e = this.editor;
    const h = this.handle();
    if (!e || !h) return;
    e.chain()
      .focus()
      .command(({ tr }) => {
        tr.setSelection(NodeSelection.create(tr.doc, h.pos));
        return true;
      })
      .run();
    this.announce('ui.lessonEditor.announce.blockSelected');
  }

  protected moveBlock(direction: -1 | 1): void {
    const e = this.editor;
    if (!e || this.lockStructure()) return;
    if (e.chain().focus().moveTopBlock(direction).run()) {
      const top = topBlockAt(e.state.doc, e.state.selection.from);
      this.announce('ui.lessonEditor.announce.blockMoved', {
        n: (top?.index ?? 0) + 1,
      });
      this.refreshState();
    }
  }

  protected deleteBlock(): void {
    const e = this.editor;
    if (!e || this.lockStructure()) return;
    if (e.chain().focus().deleteTopBlock().run()) {
      this.announce('ui.lessonEditor.announce.blockDeleted');
      this.refreshState();
    }
  }

  protected patchBlock(attrs: Record<string, unknown>): void {
    const e = this.editor;
    const b = this.selectedBlock();
    if (!e || !b) return;
    e.commands.setTopBlockAttrs(b.pos, attrs);
    this.refreshState();
  }

  // ─── Outline ─────────────────────────────────────────────────────────────
  protected outlineTypeKey(item: OutlineItem): string {
    return `ui.lessonEditor.props.types.${item.type}`;
  }

  protected goTo(item: OutlineItem): void {
    const e = this.editor;
    if (!e) return;
    const node = e.state.doc.nodeAt(item.pos);
    if (!node) return;
    e.chain()
      .focus()
      .command(({ tr }) => {
        tr.setSelection(
          node.isAtom
            ? NodeSelection.create(tr.doc, item.pos)
            : TextSelection.near(tr.doc.resolve(item.pos + 1)),
        );
        tr.scrollIntoView();
        return true;
      })
      .run();
    try {
      (e.view.nodeDOM(item.pos) as HTMLElement | null)?.scrollIntoView?.({
        block: 'center',
      });
    } catch {
      /* jsdom */
    }
  }

  private refreshOutline(e: Editor): void {
    const items: OutlineItem[] = [];
    e.state.doc.forEach((node, pos) => {
      if (!OUTLINE_TYPES.has(node.type.name)) return;
      const label =
        node.type.name === 'heading'
          ? node.textContent
          : String(
              node.attrs['question'] ??
                node.attrs['title'] ??
                node.attrs['alt'] ??
                node.attrs['language'] ??
                '',
            );
      items.push({
        pos,
        type: node.type.name,
        level:
          node.type.name === 'heading' ? Number(node.attrs['level']) || 2 : 0,
        label: label.trim(),
      });
    });
    const prev = this.outline();
    if (JSON.stringify(prev) !== JSON.stringify(items)) this.outline.set(items);
  }

  private refreshSelectedBlock(e: Editor): void {
    const top = topBlockAt(e.state.doc, e.state.selection.from);
    if (!top) {
      this.selectedBlock.set(null);
      return;
    }
    const node = top.node;
    const next: SelectedBlock = {
      pos: top.pos,
      index: top.index,
      total: e.state.doc.childCount,
      type: node.type.name,
      attrs: { ...node.attrs },
      ...(node.type.name === 'table'
        ? { rows: node.childCount, cols: node.firstChild?.childCount ?? 0 }
        : {}),
    };
    const prev = this.selectedBlock();
    if (!prev || JSON.stringify(prev) !== JSON.stringify(next))
      this.selectedBlock.set(next);
  }

  /** Structure signature of the current doc (tests / translation tooling). */
  structureSignature(): string | null {
    return this.editor ? structureSignature(this.editor.state.doc) : null;
  }

  // ─── Internals ───────────────────────────────────────────────────────────
  private currentDoc(editor: Editor): LessonDoc {
    const json = editor.getJSON() as unknown as LessonDoc;
    json.version = LESSON_DOC_VERSION;
    return json;
  }

  /** Polite live-region message (a `ui.lessonEditor.announce.*` key). */
  private announce(key: string, params?: Record<string, unknown>): void {
    const message = this.i18n.t(key, params);
    this.announcement.set('');
    queueMicrotask(() => this.announcement.set(message));
  }

  private refreshState(): void {
    const e = this.editor;
    if (!e) return;
    const calloutKind = e.isActive('callout')
      ? ((e.getAttributes('callout')['kind'] as CalloutKind | undefined) ??
        'info')
      : null;
    this.state.set({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      code: e.isActive('code'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      highlight: e.isActive('highlight'),
      kbd: e.isActive('kbd'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      paragraph: e.isActive('paragraph'),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      blockquote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      callout: calloutKind !== null,
      calloutKind,
      link: e.isActive('link'),
      inTable: isInTable(e.state),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    });
    this.refreshSelectedBlock(e);
    this.refreshOutline(e);
    this.updateBubble(e);
    if (!this.handle() || e.state.selection instanceof NodeSelection)
      this.placeHandle(e, e.state.selection.from);
  }

  /** Expose the host element for tests + outside CSS scoping. */
  get hostElement(): HTMLElement {
    return this.hostEl.nativeElement;
  }
}

interface EditorSelectionState {
  bold: boolean;
  italic: boolean;
  code: boolean;
  underline: boolean;
  strike: boolean;
  highlight: boolean;
  kbd: boolean;
  h2: boolean;
  h3: boolean;
  paragraph: boolean;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
  codeBlock: boolean;
  callout: boolean;
  calloutKind: CalloutKind | null;
  link: boolean;
  inTable: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

/** Toolbar commands that add / remove blocks (blocked in translation mode). */
const STRUCTURAL_COMMANDS = new Set<BlockToolbarCommand>([
  'paragraph',
  'h2',
  'h3',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
  'callout',
  'divider',
  'image',
  'embed',
  'table',
  'quiz',
  'insert',
  'addRowAfter',
  'addColumnAfter',
  'deleteRow',
  'deleteColumn',
  'toggleHeaderRow',
  'deleteTable',
]);

function emptySelectionState(): EditorSelectionState {
  return {
    bold: false,
    italic: false,
    code: false,
    underline: false,
    strike: false,
    highlight: false,
    kbd: false,
    h2: false,
    h3: false,
    paragraph: true,
    bulletList: false,
    orderedList: false,
    blockquote: false,
    codeBlock: false,
    callout: false,
    calloutKind: null,
    link: false,
    inTable: false,
    canUndo: false,
    canRedo: false,
  };
}
