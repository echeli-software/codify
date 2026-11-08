import { ItemSprite } from '../../atoms/item-sprite/item-sprite.js';
import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import { AVATAR_POSES, type AvatarPose } from '@codify/ui-core';
import { AppButton } from '../../atoms/app-button/app-button.js';
import { Icon } from '../../atoms/icon/icon.js';
import {
  AvatarRenderer,
  type AvatarConfigLike,
  type AvatarSlot,
  type AvatarSprite,
} from '../../molecules/avatar-renderer/avatar-renderer.js';
import { SLOT_ORDER, type ShopItem } from '../shop-grid/shop-item.js';

/** slot → equipped item id (null = nothing in that slot). */
export type EquippedMap = Partial<Record<AvatarSlot, string | null>>;

/** Default autosave delay (docs/08 §9: "after 3 s of no changes"). */
export const AUTOSAVE_MS = 3000;

let builderSeq = 0;

/**
 * Dressing room (docs/08 §9): every slot is a tab; pick an owned item for
 * it (or none) and the `AvatarRenderer` preview updates live. Changes
 * auto-save 3 s after the last pick (`autosaveMs`, 0 = off) and the
 * explicit Save button is always there. "Random" asks the host to shuffle
 * (`randomize`); the pose picker previews and emits `poseChange`; every
 * slot has a "Browse shop for [slot]" action (`browseShop`).
 *
 *   <cdf-avatar-builder [items]="owned" [equipped]="current"
 *     (save)="persist($event)" (randomize)="shuffle()" (browseShop)="open($event)" />
 */
@Component({
  selector: 'cdf-avatar-builder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ItemSprite, AvatarRenderer, AppButton, Icon, TranslatePipe],
  template: `
    <div class="cdf-builder">
      <div class="cdf-builder__preview">
        <cdf-avatar-renderer
          [config]="config()"
          [equipped]="previewSprites()"
          [size]="previewSize()"
          [pose]="poseDraft()"
          [animate]="animate()"
        />
        <p class="cdf-builder__dirty" role="status" aria-live="polite">
          @if (saving()) {
            {{ 'ui.avatarBuilder.saving' | translate }}
          } @else if (dirty()) {
            {{
              (autosaveMs() > 0
                ? 'ui.avatarBuilder.autosavePending'
                : 'ui.avatarBuilder.unsaved'
              ) | translate
            }}
          }
        </p>
        <div
          class="cdf-builder__poses"
          role="radiogroup"
          [attr.aria-label]="'ui.avatarBuilder.pose' | translate"
          data-testid="pose-picker"
        >
          @for (p of poses; track p) {
            <button
              type="button"
              role="radio"
              class="cdf-builder__pose"
              [attr.aria-checked]="poseDraft() === p"
              [attr.data-pose]="p"
              (click)="pickPose(p)"
            >
              {{ 'ui.avatarBuilder.poses.' + p | translate }}
            </button>
          }
        </div>
      </div>

      <div class="cdf-builder__controls">
        <div
          class="cdf-builder__slots"
          role="tablist"
          [attr.aria-label]="'ui.avatarBuilder.slots' | translate"
        >
          @for (slot of slots; track slot) {
            <button
              type="button"
              role="tab"
              class="cdf-builder__slot"
              [id]="tabId(slot)"
              [attr.data-slot]="slot"
              [attr.aria-selected]="slot === activeSlot()"
              [attr.aria-controls]="panelId"
              [attr.tabindex]="slot === activeSlot() ? 0 : -1"
              (click)="selectSlot(slot)"
              (keydown)="onTabKey($event)"
            >
              {{ 'ui.item.slot.' + slot | translate }}
              <span class="cdf-builder__count">{{ countFor(slot) }}</span>
            </button>
          }
        </div>

        <div
          class="cdf-builder__panel"
          role="tabpanel"
          [id]="panelId"
          [attr.aria-labelledby]="tabId(activeSlot())"
        >
          @if (itemsForSlot().length === 0) {
            <p class="cdf-builder__empty" data-testid="slot-empty">
              {{ 'ui.avatarBuilder.emptySlot' | translate }}
            </p>
          } @else {
            <div
              class="cdf-builder__options"
              role="radiogroup"
              [attr.aria-labelledby]="tabId(activeSlot())"
            >
              <button
                type="button"
                role="radio"
                class="cdf-builder__option"
                [attr.aria-checked]="!draft()[activeSlot()]"
                (click)="pick(activeSlot(), null)"
              >
                <span class="cdf-builder__glyph" aria-hidden="true">∅</span>
                <span>{{ 'ui.avatarBuilder.none' | translate }}</span>
              </button>
              @for (item of itemsForSlot(); track item.id) {
                <button
                  type="button"
                  role="radio"
                  class="cdf-builder__option"
                  [attr.data-rarity]="item.rarity"
                  [attr.aria-checked]="draft()[activeSlot()] === item.id"
                  (click)="pick(activeSlot(), item.id)"
                >
                  <cdf-item-sprite
                    [token]="item.spriteAssetId"
                    [url]="item.spriteUrl"
                    [rarity]="item.rarity"
                    [size]="28"
                  />
                  <span>{{ item.name }}</span>
                </button>
              }
            </div>
          }
          <button
            type="button"
            class="cdf-builder__shop"
            data-testid="browse-slot-shop"
            (click)="browseShop.emit(activeSlot())"
          >
            <cdf-icon name="cart" size="xs" />
            {{
              'ui.avatarBuilder.browseShop'
                | translate
                  : { slot: ('ui.item.slot.' + activeSlot() | translate) }
            }}
          </button>
        </div>

        <div class="cdf-builder__actions">
          <cdf-app-button
            kind="ghost"
            [loading]="randomizing()"
            (buttonClick)="randomize.emit()"
            data-testid="avatar-random"
          >
            <cdf-icon name="sparkles" size="sm" />
            {{ 'ui.avatarBuilder.random' | translate }}
          </cdf-app-button>
          <cdf-app-button
            kind="ghost"
            [disabled]="!dirty()"
            (buttonClick)="reset()"
          >
            {{ 'ui.avatarBuilder.reset' | translate }}
          </cdf-app-button>
          <cdf-app-button
            kind="primary"
            [disabled]="!dirty()"
            [loading]="saving()"
            (buttonClick)="saveNow()"
            data-testid="avatar-save"
          >
            {{ 'common.save' | translate }}
          </cdf-app-button>
        </div>
      </div>
    </div>
  `,
  styleUrl: './avatar-builder.scss',
})
export class AvatarBuilder {
  /** Owned items (any slot). */
  readonly items = input.required<ShopItem[]>();
  /** Currently saved equipment. */
  readonly equipped = input<EquippedMap>({});
  readonly config = input<AvatarConfigLike | null>(null);
  readonly saving = input(false);
  readonly randomizing = input(false);
  readonly previewSize = input(200);
  /** Auto-save delay after the last pick; 0 disables it. */
  readonly autosaveMs = input(AUTOSAVE_MS);
  /** Idle animation on the preview (pass false for reduced motion). */
  readonly animate = input(false);
  /** Slot tab to open first. */
  readonly initialSlot = input<AvatarSlot | null>(null);

  readonly save = output<EquippedMap>();
  /** Fires on every pick (live preview elsewhere, analytics). */
  readonly draftChange = output<EquippedMap>();
  /** "Random" pressed — the host shuffles and feeds back `equipped`. */
  readonly randomize = output<void>();
  readonly poseChange = output<AvatarPose>();
  /** "Browse shop for [slot]". */
  readonly browseShop = output<AvatarSlot>();

  protected readonly poses = AVATAR_POSES;
  protected readonly slots = SLOT_ORDER;
  protected readonly panelId = `cdf-builder-${++builderSeq}-panel`;
  private readonly uid = `cdf-builder-${builderSeq}`;
  protected readonly draft = signal<EquippedMap>({});
  private readonly activeOverride = signal<AvatarSlot | null>(null);
  private readonly poseOverride = signal<AvatarPose | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  protected readonly activeSlot = computed<AvatarSlot>(
    () =>
      this.activeOverride() ??
      this.initialSlot() ??
      SLOT_ORDER.find((s) => this.items().some((i) => i.slot === s)) ??
      'HAT',
  );
  protected readonly itemsForSlot = computed(() =>
    this.items().filter((i) => i.slot === this.activeSlot()),
  );
  protected readonly poseDraft = computed<AvatarPose>(() => {
    const own = this.poseOverride();
    if (own) return own;
    const p = this.config()?.pose;
    return (AVATAR_POSES as readonly string[]).includes(p ?? '')
      ? (p as AvatarPose)
      : 'idle';
  });

  protected readonly previewSprites = computed(() => {
    const byId = new Map(this.items().map((i) => [i.id, i]));
    const out: Partial<Record<AvatarSlot, AvatarSprite>> = {};
    for (const [slot, id] of Object.entries(this.draft()) as [
      AvatarSlot,
      string | null,
    ][]) {
      const item = id ? byId.get(id) : null;
      if (item)
        out[slot] = {
          spriteAssetId: item.spriteAssetId,
          spriteUrl: item.spriteUrl ?? null,
          name: item.name,
          rarity: item.rarity,
        };
    }
    return out;
  });

  protected readonly dirty = computed(() => {
    const a = this.draft();
    const b = this.equipped();
    return SLOT_ORDER.some((s) => (a[s] ?? null) !== (b[s] ?? null));
  });

  constructor() {
    effect(() => {
      const saved = this.equipped();
      untracked(() => {
        this.draft.set({ ...saved });
        this.clearTimer();
      });
    });
    effect(() => {
      // A new saved pose from the host wins over the local preview.
      this.config();
      untracked(() => this.poseOverride.set(null));
    });
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  protected countFor(slot: AvatarSlot): number {
    return this.items().filter((i) => i.slot === slot).length;
  }

  protected selectSlot(slot: AvatarSlot): void {
    this.activeOverride.set(slot);
  }

  protected tabId(slot: AvatarSlot): string {
    return `${this.uid}-tab-${slot}`;
  }

  protected pick(slot: AvatarSlot, id: string | null): void {
    const next = { ...this.draft(), [slot]: id };
    this.draft.set(next);
    this.draftChange.emit(next);
    this.scheduleAutosave();
  }

  protected pickPose(p: AvatarPose): void {
    this.poseOverride.set(p);
    this.poseChange.emit(p);
  }

  protected reset(): void {
    this.clearTimer();
    this.draft.set({ ...this.equipped() });
  }

  protected saveNow(): void {
    this.clearTimer();
    if (this.dirty()) this.save.emit(this.draft());
  }

  private scheduleAutosave(): void {
    this.clearTimer();
    const ms = this.autosaveMs();
    if (ms <= 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.saving()) {
        this.scheduleAutosave();
        return;
      }
      if (this.dirty()) this.save.emit(this.draft());
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Roving tabindex across slot tabs (←/→/Home/End). */
  protected onTabKey(ev: KeyboardEvent): void {
    const slots = this.slots;
    const i = slots.indexOf(this.activeSlot());
    let next = i;
    if (ev.key === 'ArrowRight') next = (i + 1) % slots.length;
    else if (ev.key === 'ArrowLeft')
      next = (i - 1 + slots.length) % slots.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = slots.length - 1;
    else return;
    ev.preventDefault();
    this.selectSlot(slots[next]);
    const el = (
      ev.currentTarget as HTMLElement
    ).parentElement?.querySelector<HTMLElement>(`#${this.tabId(slots[next])}`);
    el?.focus();
  }
}
