import {
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import { AppButton } from '../../atoms/app-button/app-button.js';
import {
  AvatarRenderer,
  type AvatarConfigLike,
  type AvatarSlot,
  type AvatarSprite,
} from '../../molecules/avatar-renderer/avatar-renderer.js';
import {
  SLOT_ORDER,
  spriteGlyph,
  type ShopItem,
} from '../shop-grid/shop-item.js';

/** slot → equipped item id (null = nothing in that slot). */
export type EquippedMap = Partial<Record<AvatarSlot, string | null>>;

let builderSeq = 0;

/**
 * Dressing room (docs/08): pick a slot, then an owned item for it; the
 * `AvatarRenderer` preview updates live while picking. Nothing persists
 * until "Save" emits the full slot → item map.
 *
 *   <cdf-avatar-builder [items]="owned" [equipped]="current" (save)="persist($event)" />
 */
@Component({
  selector: 'cdf-avatar-builder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AvatarRenderer, AppButton, TranslatePipe],
  template: `
    <div class="cdf-builder">
      <div class="cdf-builder__preview">
        <cdf-avatar-renderer
          [config]="config()"
          [equipped]="previewSprites()"
          [size]="previewSize()"
        />
        @if (dirty()) {
          <p class="cdf-builder__dirty" role="status">
            {{ 'ui.avatarBuilder.unsaved' | translate }}
          </p>
        }
      </div>

      <div class="cdf-builder__controls">
        <div
          class="cdf-builder__slots"
          role="tablist"
          [attr.aria-label]="'ui.avatarBuilder.slots' | translate"
        >
          @for (slot of slots(); track slot) {
            <button
              type="button"
              role="tab"
              class="cdf-builder__slot"
              [id]="tabId(slot)"
              [attr.aria-selected]="slot === activeSlot()"
              [attr.aria-controls]="panelId"
              [attr.tabindex]="slot === activeSlot() ? 0 : -1"
              (click)="selectSlot(slot)"
              (keydown)="onTabKey($event)"
            >
              {{ 'ui.item.slot.' + slot | translate }}
            </button>
          }
        </div>

        <div
          class="cdf-builder__panel"
          role="tabpanel"
          [id]="panelId"
          [attr.aria-labelledby]="tabId(activeSlot())"
        >
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
                [attr.aria-checked]="draft()[activeSlot()] === item.id"
                (click)="pick(activeSlot(), item.id)"
              >
                @if (glyph(item).kind === 'emoji') {
                  <span class="cdf-builder__glyph" aria-hidden="true">{{
                    glyph(item).value
                  }}</span>
                } @else {
                  <span
                    class="cdf-builder__swatch"
                    aria-hidden="true"
                    [style.background]="glyph(item).value"
                  ></span>
                }
                <span>{{ item.name }}</span>
              </button>
            }
          </div>
        </div>

        <div class="cdf-builder__actions">
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
            (buttonClick)="save.emit(draft())"
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
  readonly previewSize = input(200);

  readonly save = output<EquippedMap>();
  /** Fires on every pick (live preview elsewhere, analytics). */
  readonly draftChange = output<EquippedMap>();

  protected readonly panelId = `cdf-builder-${++builderSeq}-panel`;
  private readonly uid = `cdf-builder-${builderSeq}`;
  protected readonly draft = signal<EquippedMap>({});
  private readonly activeOverride = signal<AvatarSlot | null>(null);

  protected readonly slots = computed(() =>
    SLOT_ORDER.filter((s) => this.items().some((i) => i.slot === s)),
  );
  protected readonly activeSlot = computed<AvatarSlot>(
    () => this.activeOverride() ?? this.slots()[0] ?? 'HAT',
  );
  protected readonly itemsForSlot = computed(() =>
    this.items().filter((i) => i.slot === this.activeSlot()),
  );

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
      untracked(() => this.draft.set({ ...saved }));
    });
  }

  protected selectSlot(slot: AvatarSlot): void {
    this.activeOverride.set(slot);
  }

  protected tabId(slot: AvatarSlot): string {
    return `${this.uid}-tab-${slot}`;
  }

  protected glyph(item: ShopItem) {
    return spriteGlyph(item.spriteAssetId);
  }

  protected pick(slot: AvatarSlot, id: string | null): void {
    const next = { ...this.draft(), [slot]: id };
    this.draft.set(next);
    this.draftChange.emit(next);
  }

  protected reset(): void {
    this.draft.set({ ...this.equipped() });
  }

  /** Roving tabindex across slot tabs (←/→/Home/End). */
  protected onTabKey(ev: KeyboardEvent): void {
    const slots = this.slots();
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
