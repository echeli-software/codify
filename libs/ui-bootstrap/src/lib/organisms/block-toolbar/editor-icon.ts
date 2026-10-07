import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowClockwise,
  phosphorArrowCounterClockwise,
  phosphorCode,
  phosphorCodeBlock,
  phosphorColumnsPlusRight,
  phosphorDotOutline,
  phosphorFrameCorners,
  phosphorHighlighter,
  phosphorImage,
  phosphorInfo,
  phosphorKeyboard,
  phosphorLink,
  phosphorLinkBreak,
  phosphorListBullets,
  phosphorListChecks,
  phosphorListNumbers,
  phosphorMinus,
  phosphorMinusSquare,
  phosphorParagraph,
  phosphorPlus,
  phosphorQuotes,
  phosphorRobot,
  phosphorRows,
  phosphorRowsPlusBottom,
  phosphorColumns,
  phosphorSquare,
  phosphorSquareHalf,
  phosphorTable,
  phosphorTerminal,
  phosphorTextB,
  phosphorTextHThree,
  phosphorTextHTwo,
  phosphorTextItalic,
  phosphorTextStrikethrough,
  phosphorTextUnderline,
  phosphorTrash,
  phosphorTreeStructure,
  phosphorUploadSimple,
  phosphorWarningCircle,
  phosphorXSquare,
  phosphorDotsSixVertical,
} from '@ng-icons/phosphor-icons/regular';

/**
 * Phosphor glyphs used by the lesson editor surfaces (toolbar, block menu,
 * node views). Names are the Phosphor export names without the `phosphor`
 * prefix — the same convention `LESSON_BLOCK_REGISTRY.icon` uses — so the
 * registry can drive the menu directly. Kept local to the editor so the
 * shared `cdf-icon` set stays curated.
 */
const ICONS = {
  phosphorArrowClockwise,
  phosphorArrowCounterClockwise,
  phosphorCode,
  phosphorCodeBlock,
  phosphorColumns,
  phosphorColumnsPlusRight,
  phosphorDotOutline,
  phosphorDotsSixVertical,
  phosphorFrameCorners,
  phosphorHighlighter,
  phosphorImage,
  phosphorInfo,
  phosphorKeyboard,
  phosphorLink,
  phosphorLinkBreak,
  phosphorListBullets,
  phosphorListChecks,
  phosphorListNumbers,
  phosphorMinus,
  phosphorMinusSquare,
  phosphorParagraph,
  phosphorPlus,
  phosphorQuotes,
  phosphorRobot,
  phosphorRows,
  phosphorRowsPlusBottom,
  phosphorSquare,
  phosphorSquareHalf,
  phosphorTable,
  phosphorTerminal,
  phosphorTextB,
  phosphorTextHThree,
  phosphorTextHTwo,
  phosphorTextItalic,
  phosphorTextStrikethrough,
  phosphorTextUnderline,
  phosphorTrash,
  phosphorTreeStructure,
  phosphorUploadSimple,
  phosphorWarningCircle,
  phosphorXSquare,
};

export type EditorIconName = keyof typeof ICONS extends `phosphor${infer N}`
  ? N
  : never;

export const EDITOR_ICON_NAMES = Object.keys(ICONS).map((k) =>
  k.replace(/^phosphor/, ''),
) as EditorIconName[];

export function isEditorIconName(name: string): name is EditorIconName {
  return (EDITOR_ICON_NAMES as string[]).includes(name);
}

/** Decorative glyph for editor chrome; the owning control carries the label. */
@Component({
  selector: 'cdf-editor-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon],
  providers: [provideIcons(ICONS)],
  template: `<ng-icon [name]="glyph()" [size]="size()" aria-hidden="true" />`,
  styles: `
    :host {
      display: inline-flex;
      line-height: 0;
    }
  `,
})
export class EditorIcon {
  readonly name = input.required<EditorIconName | string>();
  readonly size = input('18');

  protected readonly glyph = computed(() => {
    const n = this.name();
    return isEditorIconName(n) ? `phosphor${n}` : 'phosphorSquare';
  });
}
