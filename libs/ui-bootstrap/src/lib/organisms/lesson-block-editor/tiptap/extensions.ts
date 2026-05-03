/**
 * Canonical Tiptap extension list. Used by both the editor (writable) and the
 * read-only renderer — keeping them aligned avoids "renders fine in admin,
 * looks broken in student" drift.
 *
 * Extensions returned in source order. Order rarely matters for Tiptap, but
 * we group: structure → marks → custom blocks → behavior.
 */

import { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { CalloutExtension } from './callout.extension.js';

export interface BuildExtensionsOptions {
  /** Visible placeholder text shown in empty paragraphs at doc start. */
  placeholder?: string;
}

export function buildLessonExtensions(opts: BuildExtensionsOptions = {}): Extensions {
  return [
    StarterKit.configure({
      // We use levels 2 + 3 only (lesson title is metadata, not in body)
      heading: { levels: [2, 3] },
      // Default link is in StarterKit but we want our own configuration
      link: false,
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      HTMLAttributes: { rel: 'noopener noreferrer' },
    }),
    Placeholder.configure({
      placeholder: opts.placeholder ?? 'Start writing the lesson…',
    }),
    CalloutExtension,
  ];
}
