import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  type Type,
} from '@angular/core';
import {
  isAllowedImageSrc,
  type AnyBlockNode,
  type BlockquoteNode,
  type BulletListNode,
  type CalloutKind,
  type CalloutNode,
  type CodeBlockNode,
  type EmbedNode,
  type HeadingNode,
  type ImageNode,
  type InlineNode,
  type LessonRefActivation,
  type OrderedListNode,
  type ParagraphNode,
  type QuizNode,
  type TableCellNode,
  type TableHeaderNode,
  type TableNode,
  type TableRowNode,
} from '@codify/lesson-schema';
import { LessonInline } from './lesson-inline.js';
import {
  LessonEmbed,
  LessonQuiz,
  LessonRef,
} from './lesson-interactive-blocks.js';
import { LessonRenderContext } from './lesson-render-context.js';

const CALLOUT_LABELS: Record<CalloutKind, string> = {
  info: 'Info',
  tip: 'Tip',
  warn: 'Warning',
  danger: 'Danger',
  success: 'Success',
};

/** Slug for heading anchors (`#section` links). */
export function headingSlug(
  content: readonly InlineNode[] | undefined,
): string {
  const text = (content ?? [])
    .map((n) => (n.type === 'text' ? n.text : ' '))
    .join('')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return text || 'section';
}

type Cell = TableHeaderNode | TableCellNode;

/**
 * Recursive block list renderer. Every LessonDoc block maps to semantic
 * HTML; unknown blocks render nothing. App overrides from
 * `LESSON_BLOCK_RENDERER` win over the defaults.
 */
@Component({
  selector: 'cdf-lesson-blocks',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgComponentOutlet,
    LessonInline,
    LessonQuiz,
    LessonEmbed,
    LessonRef,
  ],
  templateUrl: './lesson-blocks.html',
  styleUrl: './lesson-blocks.scss',
})
export class LessonBlocks {
  readonly blocks = input<readonly AnyBlockNode[] | null | undefined>([]);

  private readonly ctx = inject(LessonRenderContext);

  protected override(block: AnyBlockNode): Type<unknown> | null {
    return this.ctx.protocol?.resolve(block.type) ?? null;
  }

  // Typed accessors (templates narrow poorly over big unions).
  protected p(b: AnyBlockNode): ParagraphNode {
    return b as ParagraphNode;
  }
  protected h(b: AnyBlockNode): HeadingNode {
    return b as HeadingNode;
  }
  protected list(b: AnyBlockNode): BulletListNode | OrderedListNode {
    return b as BulletListNode;
  }
  protected ol(b: AnyBlockNode): OrderedListNode {
    return b as OrderedListNode;
  }
  protected container(b: AnyBlockNode): BlockquoteNode | CalloutNode {
    return b as BlockquoteNode;
  }
  protected callout(b: AnyBlockNode): CalloutNode {
    return b as CalloutNode;
  }
  protected code(b: AnyBlockNode): CodeBlockNode {
    return b as CodeBlockNode;
  }
  protected image(b: AnyBlockNode): ImageNode {
    return b as ImageNode;
  }
  protected embed(b: AnyBlockNode): EmbedNode {
    return b as EmbedNode;
  }
  protected quiz(b: AnyBlockNode): QuizNode {
    return b as QuizNode;
  }
  protected table(b: AnyBlockNode): TableNode {
    return b as TableNode;
  }

  protected slug(b: AnyBlockNode): string {
    return headingSlug(this.h(b).content);
  }

  protected calloutLabel(b: AnyBlockNode): string {
    return CALLOUT_LABELS[this.callout(b).attrs?.kind] ?? 'Note';
  }

  protected codeText(b: AnyBlockNode): string {
    return (this.code(b).content ?? []).map((t) => t.text).join('');
  }

  protected codeLanguage(b: AnyBlockNode): string {
    const lang = this.code(b).attrs?.language ?? 'plaintext';
    return /^[A-Za-z0-9+#._-]{1,40}$/.test(lang) ? lang : 'plaintext';
  }

  protected imageSrc(b: AnyBlockNode): string | null {
    const src = this.image(b).attrs?.src;
    return isAllowedImageSrc(src) ? src : null;
  }

  /** Rows split into a header row (first row of only header cells) + body. */
  protected tableParts(b: AnyBlockNode): {
    head: TableRowNode | null;
    body: TableRowNode[];
  } {
    const rows = this.table(b).content ?? [];
    const first = rows[0];
    const isHead =
      !!first && first.content.every((c) => c.type === 'tableHeader');
    return isHead
      ? { head: first, body: rows.slice(1) }
      : { head: null, body: rows };
  }

  protected span(cell: Cell, key: 'colspan' | 'rowspan'): number | null {
    const v = cell.attrs?.[key];
    return typeof v === 'number' && v > 1 ? v : null;
  }

  protected ref(b: AnyBlockNode): LessonRefActivation | null {
    switch (b.type) {
      case 'exerciseRef':
        return { kind: 'exercise', id: b.attrs.exerciseId };
      case 'aiPromptRef':
        return { kind: 'aiPrompt', id: b.attrs.aiPromptId };
      case 'scenarioRef':
        return { kind: 'scenario', id: b.attrs.scenarioId };
      default:
        return null;
    }
  }
}
