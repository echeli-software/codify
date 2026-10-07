/**
 * Canonical Tiptap extension list for the lesson editor. Node names, attrs
 * and nesting mirror @codify/lesson-schema so `editor.getJSON()` is a valid
 * `LessonDoc` (a spec test asserts this for the kitchen-sink doc).
 */

import {
  Extension,
  type Extensions,
  type NodeViewRenderer,
} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { isAllowedHref } from '@codify/lesson-schema';
import { CalloutExtension } from './callout.extension.js';
import {
  LessonAiPromptRef,
  LessonDocument,
  LessonEmbed,
  LessonExerciseRef,
  LessonHighlight,
  LessonImage,
  LessonKbd,
  LessonQuiz,
  LessonScenarioRef,
  LessonTable,
  LessonTableCell,
  LessonTableHeader,
  LessonTableRow,
  RootBlockCommands,
} from './lesson-nodes.js';

export type LessonNodeViewType =
  | 'image'
  | 'embed'
  | 'quiz'
  | 'exerciseRef'
  | 'aiPromptRef'
  | 'scenarioRef';

export interface BuildExtensionsOptions {
  /** Visible placeholder text shown in empty paragraphs at doc start. */
  placeholder?: string;
  /** Interactive node views keyed by node name (editor only). */
  nodeViews?: Partial<Record<LessonNodeViewType, NodeViewRenderer>>;
  /** Editor-level shortcuts that open UI owned by the Angular component. */
  onOpenLink?: () => void;
  onOpenBlockMenu?: (trigger: 'slash' | 'shortcut') => void;
}

export function buildLessonExtensions(
  opts: BuildExtensionsOptions = {},
): Extensions {
  const views = opts.nodeViews ?? {};
  const shortcuts = Extension.create({
    name: 'lessonEditorShortcuts',
    addKeyboardShortcuts() {
      const editor = this.editor;
      return {
        'Mod-k': () => {
          if (!opts.onOpenLink) return false;
          opts.onOpenLink();
          return true;
        },
        'Mod-/': () => {
          if (!opts.onOpenBlockMenu) return false;
          opts.onOpenBlockMenu('shortcut');
          return true;
        },
        // `/` at the start of an empty paragraph opens the block menu.
        '/': () => {
          if (!opts.onOpenBlockMenu) return false;
          const { $from, empty } = editor.state.selection;
          if (
            !empty ||
            $from.parent.type.name !== 'paragraph' ||
            $from.parent.content.size > 0
          ) {
            return false;
          }
          opts.onOpenBlockMenu('slash');
          return true;
        },
      };
    },
  });

  return [
    StarterKit.configure({
      document: false,
      // We use levels 2 + 3 only (lesson title is metadata, not in body)
      heading: { levels: [2, 3] },
      codeBlock: { defaultLanguage: 'plaintext' },
      // Configured below with the lesson href allowlist.
      link: false,
    }),
    LessonDocument,
    RootBlockCommands,
    Link.configure({
      openOnClick: false,
      autolink: true,
      defaultProtocol: 'https',
      HTMLAttributes: { rel: 'noopener noreferrer', target: null },
      isAllowedUri: (url) => isAllowedHref(url),
      shouldAutoLink: (url) => isAllowedHref(url),
    }),
    Placeholder.configure({
      placeholder: opts.placeholder ?? 'Start writing the lesson…',
    }),
    LessonHighlight,
    LessonKbd,
    CalloutExtension,
    LessonImage.configure({ nodeView: views.image ?? null }),
    LessonEmbed.configure({ nodeView: views.embed ?? null }),
    LessonTable,
    LessonTableRow,
    LessonTableHeader,
    LessonTableCell,
    LessonQuiz.configure({ nodeView: views.quiz ?? null }),
    LessonExerciseRef.configure({ nodeView: views.exerciseRef ?? null }),
    LessonAiPromptRef.configure({ nodeView: views.aiPromptRef ?? null }),
    LessonScenarioRef.configure({ nodeView: views.scenarioRef ?? null }),
    shortcuts,
  ];
}
