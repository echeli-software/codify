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
import { isInTable, newQuizAttrs } from './tiptap/lesson-nodes.js';
import { QuizBlockView } from './node-views/quiz-block-view.js';
import { RefBlockView } from './node-views/ref-block-view.js';
import {
  EmbedBlockView,
  ImageBlockView,
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
  imports: [BlockToolbar, BlockMenu, LinkPanel, ImagePanel, EmbedPanel],
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
  readonly placeholder = input('Start writing the lesson…');
  readonly readonly = input(false);

  private readonly hostEl = inject(ElementRef<HTMLElement>);
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
      const nodeHost = { injector: this.injector };
      this.editor = new Editor({
        element: host,
        extensions: buildLessonExtensions({
          placeholder: this.placeholder(),
          nodeViews: {
            quiz: angularNodeView(QuizBlockView, nodeHost),
            exerciseRef: angularNodeView(RefBlockView, nodeHost),
            aiPromptRef: angularNodeView(RefBlockView, nodeHost),
            scenarioRef: angularNodeView(RefBlockView, nodeHost),
            image: angularNodeView(ImageBlockView, nodeHost),
            embed: angularNodeView(EmbedBlockView, nodeHost),
          },
          onOpenLink: () => this.openLinkPanel(),
          onOpenBlockMenu: () => this.openMenu(),
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
            'aria-label': 'Lesson content',
          },
        },
        onUpdate: ({ editor }) => {
          this.refreshState();
          if (this.suppressEmit) return;
          this.onChangeFn(this.currentDoc(editor));
        },
        onSelectionUpdate: () => this.refreshState(),
        onBlur: () => this.onTouchedFn(),
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
      this.editor.commands.setContent(
        doc as unknown as Record<string, unknown>,
      );
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
          this.announce(
            'Callouts can only be placed at the top level of the lesson.',
          );
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
        this.announce('Quiz block inserted.');
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
      default:
        return;
    }
    this.announce(`${type} inserted.`);
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
    this.announce('Image inserted.');
  }

  protected insertEmbed(result: EmbedPanelResult): void {
    this.panel.set(null);
    this.editor
      ?.chain()
      .focus()
      .insertRootBlock({ type: 'embed', attrs: { ...result } })
      .run();
    this.announce('Embed inserted.');
  }

  protected closePanel(): void {
    this.panel.set(null);
    this.editor?.commands.focus();
  }

  // ─── Internals ───────────────────────────────────────────────────────────
  private currentDoc(editor: Editor): LessonDoc {
    const json = editor.getJSON() as unknown as LessonDoc;
    json.version = LESSON_DOC_VERSION;
    return json;
  }

  private announce(message: string): void {
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
