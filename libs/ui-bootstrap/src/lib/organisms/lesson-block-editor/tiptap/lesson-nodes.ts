/**
 * Custom Tiptap nodes + marks for the lesson block model
 * (@codify/lesson-schema). Node names and attrs match the schema exactly so
 * `editor.getJSON()` validates with `lessonDocSchema`.
 *
 * Groups mirror the schema's nesting rules:
 *   - `block`      nestable blocks (StarterKit text blocks + image)
 *   - `rootBlock`  root-only blocks (callout, table, embed, quiz, refs)
 * The doc accepts both; containers (listItem, blockquote, callout, cells)
 * accept only `block`.
 *
 * The installed Tiptap set is core + StarterKit + link/placeholder, so
 * image, table, highlight and embed are implemented here on top of
 * @tiptap/core and prosemirror-tables (via @tiptap/pm).
 */

import {
  Extension,
  Mark,
  Node,
  mergeAttributes,
  type JSONContent,
  type NodeViewRenderer,
} from '@tiptap/core';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from '@tiptap/pm/state';
import {
  addColumnAfter,
  addRowAfter,
  deleteColumn,
  deleteRow,
  deleteTable,
  goToNextCell,
  isInTable,
  tableEditing,
  toggleHeaderRow,
} from '@tiptap/pm/tables';
import {
  EMBED_PROVIDER_LABELS,
  isAllowedImageSrc,
  parseEmbedUrl,
  type EmbedProvider,
  type ImageWidth,
  type QuizAttrs,
} from '@codify/lesson-schema';

export interface NodeViewOption {
  /** Interactive node view (editor only). Null → static renderHTML. */
  nodeView: NodeViewRenderer | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    lessonRootBlock: {
      /** Insert a root-only block after the current top-level block. */
      insertRootBlock: (content: JSONContent) => ReturnType;
    };
    lessonHighlight: {
      toggleLessonHighlight: () => ReturnType;
    };
    lessonKbd: {
      toggleKbd: () => ReturnType;
    };
    lessonImage: {
      insertLessonImage: (attrs: {
        src: string;
        alt: string;
        caption?: string | null;
        assetId?: string | null;
        width?: ImageWidth | null;
      }) => ReturnType;
    };
    lessonTable: {
      insertLessonTable: (opts?: {
        rows?: number;
        cols?: number;
        withHeaderRow?: boolean;
      }) => ReturnType;
      lessonTableCommand: (
        op:
          | 'addRowAfter'
          | 'addColumnAfter'
          | 'deleteRow'
          | 'deleteColumn'
          | 'toggleHeaderRow'
          | 'deleteTable',
      ) => ReturnType;
    };
  }
}

/** Random id for quiz / option ids (schema: [A-Za-z0-9_-]{1,64}). */
export function shortId(prefix = ''): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return (
    prefix + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
  );
}

// ─── Document ──────────────────────────────────────────────────────────────

export const LessonDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: '(block | rootBlock)+',
});

/** `insertRootBlock`: root-only blocks always land at depth 0. */
export const RootBlockCommands = Extension.create({
  name: 'lessonRootBlock',
  addCommands() {
    return {
      insertRootBlock:
        (content) =>
        ({ state, tr, dispatch, editor }) => {
          const node = editor.schema.nodeFromJSON(content);
          const sel = state.selection;
          const { $from } = sel;
          let from: number;
          let to: number;
          if ($from.depth === 0) {
            from = to = sel instanceof NodeSelection ? sel.to : $from.pos;
          } else {
            const top = $from.node(1);
            const start = $from.before(1);
            const end = $from.after(1);
            // Replace an empty paragraph the cursor sits in; otherwise
            // insert after the top-level block.
            const emptyParagraph =
              top.type.name === 'paragraph' && top.content.size === 0;
            from = emptyParagraph ? start : end;
            to = end;
          }
          if (dispatch) {
            tr.replaceWith(from, to, node);
            if (node.isAtom) {
              tr.setSelection(NodeSelection.create(tr.doc, from));
            } else {
              tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1)));
            }
            tr.scrollIntoView();
          }
          return true;
        },
    };
  },
});

// ─── Marks ─────────────────────────────────────────────────────────────────

export const LessonHighlight = Mark.create({
  name: 'highlight',
  parseHTML() {
    return [{ tag: 'mark' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'mark',
      mergeAttributes(HTMLAttributes, { class: 'cdf-highlight' }),
      0,
    ];
  },
  addCommands() {
    return {
      toggleLessonHighlight:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-h': () => this.editor.commands.toggleLessonHighlight(),
    };
  },
});

export const LessonKbd = Mark.create({
  name: 'kbd',
  excludes: 'code',
  parseHTML() {
    return [{ tag: 'kbd' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['kbd', mergeAttributes(HTMLAttributes, { class: 'cdf-kbd' }), 0];
  },
  addCommands() {
    return {
      toggleKbd:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Alt-k': () => this.editor.commands.toggleKbd() };
  },
});

// ─── Image ─────────────────────────────────────────────────────────────────

const IMAGE_WIDTHS: ImageWidth[] = ['full', 'wide', 'inline'];

export const LessonImage = Node.create<NodeViewOption>({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addOptions() {
    return { nodeView: null };
  },
  addAttributes() {
    return {
      src: { default: null, rendered: false },
      alt: { default: '', rendered: false },
      caption: { default: null, rendered: false },
      assetId: { default: null, rendered: false },
      width: { default: 'full', rendered: false },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (el) => {
          const img = el as HTMLElement;
          const src = img.getAttribute('src');
          // Pasted data: / javascript: images never enter the doc.
          if (!isAllowedImageSrc(src)) return false;
          const width = img.getAttribute('data-width') as ImageWidth | null;
          return {
            src,
            alt: img.getAttribute('alt') ?? '',
            caption: img.getAttribute('data-caption'),
            assetId: img.getAttribute('data-asset-id'),
            width: width && IMAGE_WIDTHS.includes(width) ? width : 'full',
          };
        },
      },
    ];
  },
  renderHTML({ node }) {
    return [
      'img',
      {
        class: 'cdf-image',
        src: node.attrs['src'],
        alt: node.attrs['alt'],
        'data-caption': node.attrs['caption'],
        'data-asset-id': node.attrs['assetId'],
        'data-width': node.attrs['width'],
      },
    ];
  },
  addNodeView() {
    return this.options.nodeView;
  },
  addCommands() {
    return {
      insertLessonImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

// ─── Embed ─────────────────────────────────────────────────────────────────

export const LessonEmbed = Node.create<NodeViewOption>({
  name: 'embed',
  group: 'rootBlock',
  atom: true,
  draggable: true,
  selectable: true,
  addOptions() {
    return { nodeView: null };
  },
  addAttributes() {
    return {
      provider: { default: 'youtube', rendered: false },
      url: { default: '', rendered: false },
      title: { default: '', rendered: false },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-embed]',
        getAttrs: (el) => {
          const div = el as HTMLElement;
          const parsed = parseEmbedUrl(div.getAttribute('data-url'));
          if (!parsed) return false;
          return {
            provider: parsed.provider,
            url: div.getAttribute('data-url'),
            title: div.getAttribute('data-title') ?? '',
          };
        },
      },
    ];
  },
  renderHTML({ node }) {
    const provider = node.attrs['provider'] as EmbedProvider;
    return [
      'div',
      {
        class: 'cdf-embed-placeholder',
        'data-embed': provider,
        'data-url': node.attrs['url'],
        'data-title': node.attrs['title'],
      },
      `${EMBED_PROVIDER_LABELS[provider] ?? provider}: ${node.attrs['title'] || node.attrs['url']}`,
    ];
  },
  addNodeView() {
    return this.options.nodeView;
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('lessonEmbedPaste'),
        props: {
          // Pasting a bare allowlisted URL into an empty paragraph embeds it.
          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData('text/plain')?.trim();
            if (!text || /\s/.test(text)) return false;
            const parsed = parseEmbedUrl(text);
            if (!parsed) return false;
            const { $from } = view.state.selection;
            const parent = $from.parent;
            if (
              parent.type.name !== 'paragraph' ||
              parent.content.size > 0 ||
              $from.depth !== 1
            ) {
              return false;
            }
            return editor.commands.insertRootBlock({
              type: 'embed',
              attrs: {
                provider: parsed.provider,
                url: text,
                title: `${EMBED_PROVIDER_LABELS[parsed.provider]} embed`,
              },
            });
          },
        },
      }),
    ];
  },
});

// ─── Quiz ──────────────────────────────────────────────────────────────────

export function newQuizAttrs(): QuizAttrs {
  return {
    id: shortId('q'),
    question: '',
    kind: 'single',
    options: [
      { id: shortId('o'), text: '' },
      { id: shortId('o'), text: '' },
    ],
    correctOptionIds: [],
    explanation: null,
  };
}

export const LessonQuiz = Node.create<NodeViewOption>({
  name: 'quiz',
  group: 'rootBlock',
  atom: true,
  draggable: true,
  selectable: true,
  addOptions() {
    return { nodeView: null };
  },
  addAttributes() {
    return {
      id: { default: '', rendered: false },
      question: { default: '', rendered: false },
      kind: { default: 'single', rendered: false },
      options: { default: [], rendered: false },
      correctOptionIds: { default: [], rendered: false },
      explanation: { default: null, rendered: false },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-quiz]',
        getAttrs: (el) => {
          try {
            const raw = JSON.parse(
              (el as HTMLElement).getAttribute('data-quiz') ?? '',
            );
            return raw && typeof raw === 'object'
              ? (raw as Record<string, unknown>)
              : false;
          } catch {
            return false;
          }
        },
      },
    ];
  },
  renderHTML({ node }) {
    return [
      'div',
      {
        class: 'cdf-quiz-placeholder',
        'data-quiz': JSON.stringify(node.attrs),
      },
      `Quiz: ${node.attrs['question'] || '(no question yet)'}`,
    ];
  },
  addNodeView() {
    return this.options.nodeView;
  },
});

// ─── Ref blocks ────────────────────────────────────────────────────────────

function refNode(
  name: 'exerciseRef' | 'aiPromptRef' | 'scenarioRef',
  attr: string,
  label: string,
) {
  const dataAttr = `data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
  return Node.create<NodeViewOption>({
    name,
    group: 'rootBlock',
    atom: true,
    draggable: true,
    selectable: true,
    addOptions() {
      return { nodeView: null };
    },
    addAttributes() {
      return { [attr]: { default: '', rendered: false } };
    },
    parseHTML() {
      return [
        {
          tag: `div[${dataAttr}]`,
          getAttrs: (el) => ({
            [attr]: (el as HTMLElement).getAttribute(dataAttr) ?? '',
          }),
        },
      ];
    },
    renderHTML({ node }) {
      return [
        'div',
        { class: 'cdf-ref-placeholder', [dataAttr]: node.attrs[attr] },
        `${label}: ${node.attrs[attr] || '(not set)'}`,
      ];
    },
    addNodeView() {
      return this.options.nodeView;
    },
  });
}

export const LessonExerciseRef = refNode(
  'exerciseRef',
  'exerciseId',
  'Code exercise',
);
export const LessonAiPromptRef = refNode(
  'aiPromptRef',
  'aiPromptId',
  'AI prompt',
);
export const LessonScenarioRef = refNode(
  'scenarioRef',
  'scenarioId',
  'Scenario',
);

// ─── Tables (prosemirror-tables) ───────────────────────────────────────────

const TABLE_ROLES: Record<string, string> = {
  table: 'table',
  tableRow: 'row',
  tableCell: 'cell',
  tableHeader: 'header_cell',
};

/** Adds `tableRole` to the table node specs (prosemirror-tables needs it). */
const TableRoles = Extension.create({
  name: 'lessonTableRoles',
  extendNodeSchema(extension) {
    const role = TABLE_ROLES[extension.name];
    return role ? { tableRole: role } : {};
  },
});

function cellAttributes() {
  return {
    colspan: {
      default: 1,
      parseHTML: (el: HTMLElement) =>
        Number(el.getAttribute('colspan') ?? 1) || 1,
      renderHTML: (attrs: Record<string, unknown>) =>
        attrs['colspan'] === 1 ? {} : { colspan: attrs['colspan'] },
    },
    rowspan: {
      default: 1,
      parseHTML: (el: HTMLElement) =>
        Number(el.getAttribute('rowspan') ?? 1) || 1,
      renderHTML: (attrs: Record<string, unknown>) =>
        attrs['rowspan'] === 1 ? {} : { rowspan: attrs['rowspan'] },
    },
    colwidth: {
      default: null,
      parseHTML: (el: HTMLElement) => {
        const v = el.getAttribute('data-colwidth');
        return v ? v.split(',').map(Number) : null;
      },
      renderHTML: (attrs: Record<string, unknown>) =>
        Array.isArray(attrs['colwidth'])
          ? { 'data-colwidth': (attrs['colwidth'] as number[]).join(',') }
          : {},
    },
  };
}

export const LessonTableCell = Node.create({
  name: 'tableCell',
  content: 'block+',
  isolating: true,
  addAttributes: cellAttributes,
  parseHTML() {
    return [{ tag: 'td' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['td', HTMLAttributes, 0];
  },
});

export const LessonTableHeader = Node.create({
  name: 'tableHeader',
  content: 'block+',
  isolating: true,
  addAttributes: cellAttributes,
  parseHTML() {
    return [{ tag: 'th' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['th', mergeAttributes(HTMLAttributes, { scope: 'col' }), 0];
  },
});

export const LessonTableRow = Node.create({
  name: 'tableRow',
  content: '(tableCell | tableHeader)+',
  parseHTML() {
    return [{ tag: 'tr' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['tr', HTMLAttributes, 0];
  },
});

const TABLE_OPS = {
  addRowAfter,
  addColumnAfter,
  deleteRow,
  deleteColumn,
  deleteTable,
  toggleHeaderRow,
};

export const LessonTable = Node.create({
  name: 'table',
  group: 'rootBlock',
  content: 'tableRow+',
  isolating: true,
  parseHTML() {
    return [{ tag: 'table' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'table',
      mergeAttributes(HTMLAttributes, { class: 'cdf-table' }),
      ['tbody', 0],
    ];
  },
  addCommands() {
    return {
      insertLessonTable:
        ({ rows = 3, cols = 3, withHeaderRow = true } = {}) =>
        ({ commands }) =>
          commands.insertRootBlock({
            type: 'table',
            content: Array.from({ length: rows }, (_, r) => ({
              type: 'tableRow',
              content: Array.from({ length: cols }, () => ({
                type: withHeaderRow && r === 0 ? 'tableHeader' : 'tableCell',
                content: [{ type: 'paragraph' }],
              })),
            })),
          }),
      lessonTableCommand:
        (op) =>
        ({ state, dispatch }) =>
          TABLE_OPS[op](state, dispatch),
    };
  },
  addKeyboardShortcuts() {
    return {
      Tab: () =>
        isInTable(this.editor.state)
          ? goToNextCell(1)(this.editor.state, this.editor.view.dispatch)
          : false,
      'Shift-Tab': () =>
        isInTable(this.editor.state)
          ? goToNextCell(-1)(this.editor.state, this.editor.view.dispatch)
          : false,
    };
  },
  addProseMirrorPlugins() {
    return [tableEditing()];
  },
  addExtensions() {
    return [TableRoles];
  },
});

export { isInTable };
