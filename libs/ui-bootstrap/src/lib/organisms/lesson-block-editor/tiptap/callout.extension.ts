/**
 * Tiptap node extension for the Callout block. The single non-stock block we
 * ship in Phase 2h. Renders as a `<div data-callout="info">` so the read-only
 * renderer can style it without parsing attrs.
 *
 * Allowed contents: any nestable block (lists, code, images…). Callouts
 * are root-only, so no nested callouts.
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
      setCalloutKind: (kind: CalloutKind) => ReturnType;
      unsetCallout: () => ReturnType;
    };
  }
}

export const CalloutExtension = Node.create<CalloutOptions>({
  name: 'callout',
  // Root-only (see lesson-schema nesting rules): callouts hold nestable
  // `block` content but are themselves `rootBlock`, so a callout can never
  // end up inside another callout, a list or a blockquote.
  group: 'rootBlock',
  content: 'block+',
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      kind: {
        default: 'info',
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute('data-callout') ?? 'info',
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
      mergeAttributes(
        this.options.HTMLAttributes,
        { class: 'cdf-callout' },
        HTMLAttributes,
      ),
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
      setCalloutKind:
        (kind) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { kind }),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
    };
  },
});
