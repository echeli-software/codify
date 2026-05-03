/**
 * Tiptap node extension for the Callout block. The single non-stock block we
 * ship in Phase 2h. Renders as a `<div data-callout="info">` so the read-only
 * renderer can style it without parsing attrs.
 *
 * Allowed contents: any block (so nested lists, code, etc. can live inside
 * a callout). No nested callouts to avoid visual chaos.
 */

import { mergeAttributes, Node } from '@tiptap/core';
import type { CalloutKind } from '@codify/lesson-schema';

export interface CalloutOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (kind: CalloutKind) => ReturnType;
      toggleCallout: (kind: CalloutKind) => ReturnType;
      unsetCallout: () => ReturnType;
    };
  }
}

export const CalloutExtension = Node.create<CalloutOptions>({
  name: 'callout',
  group: 'block',
  // No nested callouts — block- contains everything except itself
  content: '(paragraph|heading|bulletList|orderedList|blockquote|codeBlock|horizontalRule)+',
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      kind: {
        default: 'info',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-callout') ?? 'info',
        renderHTML: (attrs) => ({ 'data-callout': attrs['kind'] }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, { class: 'cdf-callout' }, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      setCallout:
        (kind) =>
        ({ commands }) =>
          commands.wrapIn(this.name, { kind }),
      toggleCallout:
        (kind) =>
        ({ commands }) =>
          commands.toggleWrap(this.name, { kind }),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
    };
  },
});
