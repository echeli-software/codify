import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorCheck,
  phosphorX,
  phosphorMagnifyingGlass,
  phosphorGear,
  phosphorPlus,
  phosphorTrash,
  phosphorPencil,
  phosphorCaretDown,
  phosphorCaretRight,
  phosphorCaretLeft,
  phosphorCaretUp,
  phosphorWarning,
  phosphorInfo,
  phosphorXCircle,
  phosphorCheckCircle,
  phosphorEye,
  phosphorEyeSlash,
  phosphorMoon,
  phosphorSun,
  phosphorTranslate,
  phosphorUserCircle,
  phosphorSignOut,
  phosphorSpinnerGap,
  phosphorList,
  phosphorCreditCard,
  phosphorArrowClockwise,
  phosphorTrophy,
} from '@ng-icons/phosphor-icons/regular';

/**
 * Curated icon set. Adding an icon = import here + add to provideIcons map.
 * The strict union of names protects callers from typos and mislabels at
 * compile time.
 */
export const ICON_NAMES = [
  'check',
  'x',
  'search',
  'gear',
  'plus',
  'trash',
  'pencil',
  'caret-down',
  'caret-right',
  'caret-left',
  'caret-up',
  'warning',
  'info',
  'x-circle',
  'check-circle',
  'eye',
  'eye-slash',
  'moon',
  'sun',
  'translate',
  'user-circle',
  'sign-out',
  'spinner',
  'menu',
  'credit-card',
  'arrow-clockwise',
  'trophy',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

const NAME_TO_PHOSPHOR: Record<IconName, string> = {
  check: 'phosphorCheck',
  x: 'phosphorX',
  search: 'phosphorMagnifyingGlass',
  gear: 'phosphorGear',
  plus: 'phosphorPlus',
  trash: 'phosphorTrash',
  pencil: 'phosphorPencil',
  'caret-down': 'phosphorCaretDown',
  'caret-right': 'phosphorCaretRight',
  'caret-left': 'phosphorCaretLeft',
  'caret-up': 'phosphorCaretUp',
  warning: 'phosphorWarning',
  info: 'phosphorInfo',
  'x-circle': 'phosphorXCircle',
  'check-circle': 'phosphorCheckCircle',
  eye: 'phosphorEye',
  'eye-slash': 'phosphorEyeSlash',
  moon: 'phosphorMoon',
  sun: 'phosphorSun',
  translate: 'phosphorTranslate',
  'user-circle': 'phosphorUserCircle',
  'sign-out': 'phosphorSignOut',
  spinner: 'phosphorSpinnerGap',
  menu: 'phosphorList',
  'credit-card': 'phosphorCreditCard',
  'arrow-clockwise': 'phosphorArrowClockwise',
  trophy: 'phosphorTrophy',
};

@Component({
  selector: 'cdf-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon],
  providers: [
    provideIcons({
      phosphorCheck,
      phosphorX,
      phosphorMagnifyingGlass,
      phosphorGear,
      phosphorPlus,
      phosphorTrash,
      phosphorPencil,
      phosphorCaretDown,
      phosphorCaretRight,
      phosphorCaretLeft,
      phosphorCaretUp,
      phosphorWarning,
      phosphorInfo,
      phosphorXCircle,
      phosphorCheckCircle,
      phosphorEye,
      phosphorEyeSlash,
      phosphorMoon,
      phosphorSun,
      phosphorTranslate,
      phosphorUserCircle,
      phosphorSignOut,
      phosphorSpinnerGap,
      phosphorList,
      phosphorCreditCard,
      phosphorArrowClockwise,
      phosphorTrophy,
    }),
  ],
  template: `<ng-icon [name]="phosphorName()" [size]="sizePx()" [attr.aria-label]="label() || null" [attr.role]="label() ? 'img' : null" />`,
  styleUrl: './icon.scss',
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input<'xs' | 'sm' | 'md' | 'lg' | 'xl'>('md');
  /** Accessible label. Omit for purely decorative icons. */
  readonly label = input<string | null>(null);

  protected readonly phosphorName = computed(() => NAME_TO_PHOSPHOR[this.name()]);
  protected readonly sizePx = computed(() => {
    const s = this.size();
    if (s === 'xs') return '12';
    if (s === 'sm') return '16';
    if (s === 'lg') return '24';
    if (s === 'xl') return '32';
    return '20';
  });
}
