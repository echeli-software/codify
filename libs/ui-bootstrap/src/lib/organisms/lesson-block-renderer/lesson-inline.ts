import { DOCUMENT } from '@angular/common';
import { Directive, ElementRef, effect, inject, input } from '@angular/core';
import {
  isAllowedHref,
  type InlineNode,
  type MarkType,
} from '@codify/lesson-schema';

const TAGS: Partial<Record<MarkType['type'], string>> = {
  bold: 'strong',
  italic: 'em',
  underline: 'u',
  strike: 's',
  code: 'code',
  highlight: 'mark',
  kbd: 'kbd',
};

/**
 * Renders inline lesson content (text + marks + hard breaks) into the host
 * element with DOM APIs only — text goes through `createTextNode`, never
 * innerHTML, and link hrefs are re-checked against the allowlist.
 *
 *   <p [cdfLessonInline]="paragraph.content"></p>
 */
@Directive({ selector: '[cdfLessonInline]' })
export class LessonInline {
  readonly nodes = input<readonly InlineNode[] | null | undefined>(undefined, {
    alias: 'cdfLessonInline',
  });

  private readonly el =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly doc = inject(DOCUMENT);

  constructor() {
    effect(() => this.render(this.nodes() ?? []));
  }

  private render(nodes: readonly InlineNode[]): void {
    while (this.el.firstChild) this.el.removeChild(this.el.firstChild);
    for (const node of nodes) {
      if (node.type === 'hardBreak') {
        this.el.appendChild(this.doc.createElement('br'));
        continue;
      }
      if (node.type !== 'text' || typeof node.text !== 'string') continue;
      let out: Node = this.doc.createTextNode(node.text);
      // First mark is outermost: wrap from the innermost outwards.
      for (const mark of [...(node.marks ?? [])].reverse()) {
        const wrapper = this.wrap(mark);
        if (!wrapper) continue;
        wrapper.appendChild(out);
        out = wrapper;
      }
      this.el.appendChild(out);
    }
  }

  private wrap(mark: MarkType): HTMLElement | null {
    if (mark.type === 'link') {
      const href = mark.attrs?.href;
      if (!isAllowedHref(href)) return null;
      const a = this.doc.createElement('a');
      a.setAttribute('href', href);
      if (mark.attrs.target === '_blank') {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
      return a;
    }
    const tag = TAGS[mark.type];
    if (!tag) return null;
    const el = this.doc.createElement(tag);
    if (mark.type === 'highlight') el.className = 'cdf-highlight';
    if (mark.type === 'kbd') el.className = 'cdf-kbd';
    return el;
  }
}
