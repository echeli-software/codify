import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
} from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  flame,
  sparkles,
  trophy,
  trophyOutline,
  ribbon,
  star,
  starOutline,
  checkmarkCircle,
  closeCircle,
  warning,
  informationCircle,
  search,
  settingsOutline,
  add,
  trash,
  pencil,
  chevronForward,
  chevronBack,
  chevronUp,
  chevronDown,
  close,
  ellipsisHorizontal,
  ellipsisVertical,
  notifications,
  notificationsOff,
  bookmark,
  bookmarkOutline,
  heart,
  heartOutline,
  share,
  download,
  cloudOffline,
  refresh,
  filter,
  sunny,
  moon,
  language,
  person,
  personCircle,
  logOut,
  logIn,
  home,
  homeOutline,
  school,
  schoolOutline,
  cart,
  cartOutline,
  podium,
  podiumOutline,
  apps,
  appsOutline,
  gift,
  giftOutline,
  diamond,
  hourglass,
  rocket,
  shield,
  shieldCheckmark,
  hardwareChip,
  chatbubble,
  chatbubbleEllipses,
  helpCircle,
  send,
  arrowForward,
  arrowBack,
  lockClosed,
  play,
  mic,
  colorPalette,
  shirt,
} from 'ionicons/icons';

/**
 * Curated ionicon set for the student app. Adding an icon = import here +
 * add to NAME_MAP. The strict `IconName` union catches typos at compile time.
 *
 * Use `<cdf-icon name="flame" size="md" label="Streak" />`. Omit `label` for
 * decorative icons.
 */
export const ICON_NAMES = [
  // gamification
  'flame',
  'sparkles',
  'trophy',
  'trophy-outline',
  'ribbon',
  'star',
  'star-outline',
  'gift',
  'gift-outline',
  'diamond',
  'rocket',
  'shield',
  'shield-checkmark',

  // feedback
  'check-circle',
  'x-circle',
  'warning',
  'info-circle',

  // controls
  'search',
  'settings',
  'add',
  'trash',
  'pencil',
  'close',
  'menu-h',
  'menu-v',
  'filter',
  'refresh',

  // navigation
  'chevron-forward',
  'chevron-back',
  'chevron-up',
  'chevron-down',
  'arrow-forward',
  'arrow-back',
  'home',
  'home-outline',
  'school',
  'school-outline',
  'cart',
  'cart-outline',
  'podium',
  'podium-outline',
  'apps',
  'apps-outline',

  // state
  'notifications',
  'notifications-off',
  'bookmark',
  'bookmark-outline',
  'heart',
  'heart-outline',
  'share',
  'download',
  'cloud-offline',
  'hourglass',

  // person
  'person',
  'person-circle',
  'log-out',
  'log-in',

  // theme + i18n
  'sun',
  'moon',
  'language',

  // social / chat
  'chat',
  'chat-ellipses',
  'send',
  'help-circle',

  // tech
  'chip',
  // roadmap additions
  'lock',
  'play',
  'mic',
  'color-palette',
  'shirt',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

const NAME_MAP: Record<IconName, { name: string; svg: string }> = {
  flame: { name: 'flame', svg: flame },
  sparkles: { name: 'sparkles', svg: sparkles },
  trophy: { name: 'trophy', svg: trophy },
  'trophy-outline': { name: 'trophy-outline', svg: trophyOutline },
  ribbon: { name: 'ribbon', svg: ribbon },
  star: { name: 'star', svg: star },
  'star-outline': { name: 'star-outline', svg: starOutline },
  gift: { name: 'gift', svg: gift },
  'gift-outline': { name: 'gift-outline', svg: giftOutline },
  diamond: { name: 'diamond', svg: diamond },
  rocket: { name: 'rocket', svg: rocket },
  shield: { name: 'shield', svg: shield },
  'shield-checkmark': { name: 'shield-checkmark', svg: shieldCheckmark },

  'check-circle': { name: 'check-circle', svg: checkmarkCircle },
  'x-circle': { name: 'x-circle', svg: closeCircle },
  warning: { name: 'warning', svg: warning },
  'info-circle': { name: 'info-circle', svg: informationCircle },

  search: { name: 'search', svg: search },
  settings: { name: 'settings', svg: settingsOutline },
  add: { name: 'add', svg: add },
  trash: { name: 'trash', svg: trash },
  pencil: { name: 'pencil', svg: pencil },
  close: { name: 'close', svg: close },
  'menu-h': { name: 'menu-h', svg: ellipsisHorizontal },
  'menu-v': { name: 'menu-v', svg: ellipsisVertical },
  filter: { name: 'filter', svg: filter },
  refresh: { name: 'refresh', svg: refresh },

  'chevron-forward': { name: 'chevron-forward', svg: chevronForward },
  'chevron-back': { name: 'chevron-back', svg: chevronBack },
  'chevron-up': { name: 'chevron-up', svg: chevronUp },
  'chevron-down': { name: 'chevron-down', svg: chevronDown },
  'arrow-forward': { name: 'arrow-forward', svg: arrowForward },
  'arrow-back': { name: 'arrow-back', svg: arrowBack },
  home: { name: 'home', svg: home },
  'home-outline': { name: 'home-outline', svg: homeOutline },
  school: { name: 'school', svg: school },
  'school-outline': { name: 'school-outline', svg: schoolOutline },
  cart: { name: 'cart', svg: cart },
  'cart-outline': { name: 'cart-outline', svg: cartOutline },
  podium: { name: 'podium', svg: podium },
  'podium-outline': { name: 'podium-outline', svg: podiumOutline },
  apps: { name: 'apps', svg: apps },
  'apps-outline': { name: 'apps-outline', svg: appsOutline },

  notifications: { name: 'notifications', svg: notifications },
  'notifications-off': { name: 'notifications-off', svg: notificationsOff },
  bookmark: { name: 'bookmark', svg: bookmark },
  'bookmark-outline': { name: 'bookmark-outline', svg: bookmarkOutline },
  heart: { name: 'heart', svg: heart },
  'heart-outline': { name: 'heart-outline', svg: heartOutline },
  share: { name: 'share', svg: share },
  download: { name: 'download', svg: download },
  'cloud-offline': { name: 'cloud-offline', svg: cloudOffline },
  hourglass: { name: 'hourglass', svg: hourglass },

  person: { name: 'person', svg: person },
  'person-circle': { name: 'person-circle', svg: personCircle },
  'log-out': { name: 'log-out', svg: logOut },
  'log-in': { name: 'log-in', svg: logIn },

  sun: { name: 'sun', svg: sunny },
  moon: { name: 'moon', svg: moon },
  language: { name: 'language', svg: language },

  chat: { name: 'chat', svg: chatbubble },
  'chat-ellipses': { name: 'chat-ellipses', svg: chatbubbleEllipses },
  send: { name: 'send', svg: send },
  'help-circle': { name: 'help-circle', svg: helpCircle },

  chip: { name: 'chip', svg: hardwareChip },

  lock: { name: 'lock-closed', svg: lockClosed },
  play: { name: 'play', svg: play },
  mic: { name: 'mic', svg: mic },
  'color-palette': { name: 'color-palette', svg: colorPalette },
  shirt: { name: 'shirt', svg: shirt },
};

// Register every icon once at module load. ion-icon will then resolve by name.
addIcons(
  Object.fromEntries(Object.values(NAME_MAP).map((e) => [e.name, e.svg])),
);

@Component({
  selector: 'cdf-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonIcon],
  host: { '[attr.data-size]': 'size()' },
  template: `
    <ion-icon
      [name]="ionName()"
      [attr.aria-label]="label() || null"
      [attr.role]="label() ? 'img' : null"
      [attr.aria-hidden]="label() ? null : 'true'"
    />
  `,
  styleUrl: './icon.scss',
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input<'xs' | 'sm' | 'md' | 'lg' | 'xl'>('md');
  /** Accessible label. Omit for purely decorative icons. */
  readonly label = input<string | null>(null);

  protected readonly ionName = computed(() => NAME_MAP[this.name()].name);
}
