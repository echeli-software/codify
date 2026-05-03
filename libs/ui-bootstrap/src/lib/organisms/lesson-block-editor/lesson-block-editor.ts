import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
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
import { Icon } from '../../atoms/icon/icon.js';
import { IconButton } from '../../atoms/icon-button/icon-button.js';

/**
 * Tiptap-backed lesson editor.
 *
 * Two-way bindable as a form control: writes/emits a `LessonDoc` JSON value.
 *
 *   <cdf-lesson-block-editor [(ngModel)]="doc" />
 *
 * Toolbar covers the v1 block set: heading H2/H3, lists, blockquote, code
 * block, callouts (info/tip/warn/danger/success), divider, plus inline
 * marks (bold/italic/code/link). More blocks land per registry as later
 * phases ship them.
 */
@Component({
  selector: 'cdf-lesson-block-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, IconButton],
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
  private readonly editorContainer = viewChild.required<ElementRef<HTMLElement>>('editorHost');

  /** Current editor selection state — drives toolbar active highlights. */
  protected readonly state = signal<EditorSelectionState>(emptySelectionState());

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
      this.editor = new Editor({
        element: host,
        extensions: buildLessonExtensions({ placeholder: this.placeholder() }),
        editable: !this.readonly(),
        content: this.pendingValue ?? emptyLessonDoc(),
        onUpdate: ({ editor }) => {
          if (this.suppressEmit) return;
          const json = editor.getJSON() as unknown as LessonDoc;
          json.version = LESSON_DOC_VERSION;
          this.onChangeFn(json);
          this.refreshState();
        },
        onSelectionUpdate: () => this.refreshState(),
        onBlur: () => this.onTouchedFn(),
      });
      this.refreshState();
    });

    // React to readonly changes
    effect(() => {
      const ro = this.readonly();
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
      this.editor.commands.setContent(doc as unknown as Record<string, unknown>);
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
    this.editor?.setEditable(!isDisabled);
  }

  // ─── Toolbar commands ────────────────────────────────────────────────────
  protected toggleMark(mark: 'bold' | 'italic' | 'code' | 'underline' | 'strike'): void {
    if (!this.editor) return;
    this.editor.chain().focus().toggleMark(mark).run();
  }

  protected toggleHeading(level: 2 | 3): void {
    this.editor?.chain().focus().toggleHeading({ level }).run();
  }

  protected toggleParagraph(): void {
    this.editor?.chain().focus().setParagraph().run();
  }

  protected toggleList(kind: 'bulletList' | 'orderedList'): void {
    if (!this.editor) return;
    if (kind === 'bulletList') this.editor.chain().focus().toggleBulletList().run();
    else this.editor.chain().focus().toggleOrderedList().run();
  }

  protected toggleBlockquote(): void {
    this.editor?.chain().focus().toggleBlockquote().run();
  }

  protected toggleCodeBlock(): void {
    this.editor?.chain().focus().toggleCodeBlock().run();
  }

  protected setCallout(kind: CalloutKind): void {
    this.editor?.chain().focus().toggleCallout(kind).run();
  }

  protected insertDivider(): void {
    this.editor?.chain().focus().setHorizontalRule().run();
  }

  protected setLink(): void {
    if (!this.editor) return;
    const previous = this.editor.getAttributes('link')['href'] as string | undefined;
    const url = window.prompt('URL', previous ?? 'https://');
    if (url === null) return;
    if (url === '') {
      this.editor.chain().focus().unsetLink().run();
      return;
    }
    this.editor.chain().focus().setLink({ href: url }).run();
  }

  // ─── Internals ───────────────────────────────────────────────────────────
  private refreshState(): void {
    if (!this.editor) return;
    this.state.set({
      bold: this.editor.isActive('bold'),
      italic: this.editor.isActive('italic'),
      code: this.editor.isActive('code'),
      underline: this.editor.isActive('underline'),
      strike: this.editor.isActive('strike'),
      h2: this.editor.isActive('heading', { level: 2 }),
      h3: this.editor.isActive('heading', { level: 3 }),
      paragraph: this.editor.isActive('paragraph'),
      bulletList: this.editor.isActive('bulletList'),
      orderedList: this.editor.isActive('orderedList'),
      blockquote: this.editor.isActive('blockquote'),
      codeBlock: this.editor.isActive('codeBlock'),
      callout: this.editor.isActive('callout'),
      link: this.editor.isActive('link'),
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
  h2: boolean;
  h3: boolean;
  paragraph: boolean;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
  codeBlock: boolean;
  callout: boolean;
  link: boolean;
}

function emptySelectionState(): EditorSelectionState {
  return {
    bold: false,
    italic: false,
    code: false,
    underline: false,
    strike: false,
    h2: false,
    h3: false,
    paragraph: true,
    bulletList: false,
    orderedList: false,
    blockquote: false,
    codeBlock: false,
    callout: false,
    link: false,
  };
}
