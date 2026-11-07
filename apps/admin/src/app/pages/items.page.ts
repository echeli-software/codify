import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import {
  AssetPicker,
  type AssetSummary,
  Badge,
  type BadgeVariant,
  Button,
  ConfirmDialogService,
  DateRangePicker,
  type DateRange,
  Drawer,
  EmptyState,
  FormField,
  Icon,
  IconButton,
  Input,
  ItemSpritePreview,
  type PreviewItem,
  RadioGroup,
  type RadioOption,
  Select,
  type SelectOption,
  Skeleton,
  ToastService,
  Toggle,
} from '@codify/ui-bootstrap';
import {
  ItemsClient,
  type CreateItemBody,
  type Item,
  type ItemCategory,
  type ItemRarity,
  type ItemSlot,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { SLUG_PATTERN, isoToLocal, localToIso } from '../core/catalog';

const SLOTS: readonly ItemSlot[] = [
  'PET',
  'BACKGROUND',
  'TOP',
  'BOTTOM',
  'SHOES',
  'HAT',
  'HAIR',
  'GLASSES',
  'ACCESSORY',
  'FRAME',
  'EMOTE',
];
const RARITIES: readonly ItemRarity[] = [
  'COMMON',
  'UNCOMMON',
  'RARE',
  'EPIC',
  'LEGENDARY',
];
const RARITY_VARIANT: Record<ItemRarity, BadgeVariant> = {
  COMMON: 'neutral',
  UNCOMMON: 'success',
  RARE: 'info',
  EPIC: 'primary',
  LEGENDARY: 'premium',
};

type SpriteMode = 'asset' | 'emoji' | 'color';

interface ItemForm {
  id: string | null;
  slug: string;
  name: string;
  description: string;
  slot: ItemSlot;
  categorySlug: string;
  rarity: ItemRarity;
  costCoins: number;
  requiredLevel: number;
  isPremiumOnly: boolean;
  isLimitedDrop: boolean;
  drop: DateRange;
  isActive: boolean;
  spriteMode: SpriteMode;
  sprite: AssetSummary | null;
  emoji: string;
  color: string;
}

/** Split a stored `spriteAssetId` into the editor's sprite mode + value. */
export function parseSpriteRef(ref: string): {
  mode: SpriteMode;
  emoji: string;
  color: string;
  url: string | null;
} {
  if (ref.startsWith('emoji:'))
    return { mode: 'emoji', emoji: ref.slice(6), color: '#88ccff', url: null };
  if (ref.startsWith('color:'))
    return { mode: 'color', emoji: '🎁', color: ref.slice(6), url: null };
  return { mode: 'asset', emoji: '🎁', color: '#88ccff', url: ref || null };
}

/** Build the `spriteAssetId` the API stores from the editor state. */
export function spriteRefOf(
  f: Pick<ItemForm, 'spriteMode' | 'sprite' | 'emoji' | 'color'>,
): string {
  if (f.spriteMode === 'emoji') return `emoji:${f.emoji.trim()}`;
  if (f.spriteMode === 'color') return `color:${f.color.trim()}`;
  return f.sprite?.url ?? '';
}

/**
 * Shop → Items (docs/08): catalogue table plus a drawer editor — sprite
 * from the media library (SPRITE assets) or an emoji / colour token, live
 * `ItemSpritePreview`, cost / level / premium, limited-drop window and
 * active flag. Item categories are managed inline.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    AssetPicker,
    Badge,
    Button,
    DateRangePicker,
    Drawer,
    EmptyState,
    FormField,
    Icon,
    IconButton,
    Input,
    ItemSpritePreview,
    RadioGroup,
    Select,
    Skeleton,
    Toggle,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <div class="admin-page">
      <header class="page-head">
        <div>
          <h1>{{ 'admin.items.title' | translate }}</h1>
          <p class="muted">{{ 'admin.items.subtitle' | translate }}</p>
        </div>
        <cdf-button
          kind="primary"
          (click)="startCreate()"
          data-testid="new-item"
        >
          <cdf-icon name="plus" size="sm" />
          {{ 'admin.items.new' | translate }}
        </cdf-button>
      </header>

      <section class="admin-card">
        <h2>{{ 'admin.items.categories' | translate }}</h2>
        <div class="chip-row">
          @for (c of categories(); track c.slug) {
            <cdf-badge variant="neutral" [subtle]="true">{{
              c.name
            }}</cdf-badge>
          }
        </div>
        <div class="form-grid cat-form">
          <cdf-form-field
            [label]="'admin.common.slug' | translate"
            controlId="icat-slug"
          >
            <cdf-input inputId="icat-slug" [(ngModel)]="newCategory.slug" />
          </cdf-form-field>
          <cdf-form-field
            [label]="'admin.common.name' | translate"
            controlId="icat-name"
          >
            <cdf-input inputId="icat-name" [(ngModel)]="newCategory.name" />
          </cdf-form-field>
          <cdf-button
            kind="secondary"
            [loading]="busy() === 'category'"
            (click)="addCategory()"
          >
            {{ 'admin.items.addCategory' | translate }}
          </cdf-button>
        </div>
      </section>

      <section class="admin-card">
        <h2>
          {{ 'admin.items.count' | translate: { count: items().length } }}
        </h2>
        @if (loading()) {
          <cdf-skeleton shape="rect" height="160px" />
        } @else if (items().length === 0) {
          <cdf-empty-state
            icon="gift"
            [title]="'admin.items.emptyTitle' | translate"
            [description]="'admin.items.emptyDescription' | translate"
          />
        } @else {
          <div class="table-scroll">
            <table class="admin-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span class="visually-hidden">{{
                      'admin.items.sprite' | translate
                    }}</span>
                  </th>
                  <th scope="col">{{ 'admin.common.name' | translate }}</th>
                  <th scope="col">{{ 'admin.items.slot' | translate }}</th>
                  <th scope="col">{{ 'admin.items.rarity' | translate }}</th>
                  <th scope="col" class="num">
                    {{ 'admin.items.cost' | translate }}
                  </th>
                  <th scope="col" class="num">
                    {{ 'admin.items.level' | translate }}
                  </th>
                  <th scope="col">{{ 'admin.items.drop' | translate }}</th>
                  <th scope="col">
                    <span class="visually-hidden">{{
                      'admin.common.actions' | translate
                    }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (it of items(); track it.id) {
                  <tr [attr.data-item-id]="it.id">
                    <td class="sprite-cell">
                      @switch (spriteKind(it.spriteAssetId)) {
                        @case ('emoji') {
                          <span aria-hidden="true">{{
                            it.spriteAssetId.slice(6)
                          }}</span>
                        }
                        @case ('color') {
                          <span
                            class="swatch"
                            [style.background]="it.spriteAssetId.slice(6)"
                          ></span>
                        }
                        @default {
                          <img
                            [src]="it.spriteAssetId"
                            alt=""
                            width="32"
                            height="32"
                          />
                        }
                      }
                    </td>
                    <td>
                      <strong>{{ it.name }}</strong>
                      <div class="mono muted">{{ it.slug }}</div>
                      <span class="chip-row">
                        @if (it.isPremiumOnly) {
                          <cdf-badge variant="premium" [subtle]="true">{{
                            'admin.items.premium' | translate
                          }}</cdf-badge>
                        }
                        @if (!it.isActive) {
                          <cdf-badge variant="neutral" [subtle]="true">{{
                            'admin.common.inactive' | translate
                          }}</cdf-badge>
                        }
                      </span>
                    </td>
                    <td>{{ 'admin.items.slots.' + it.slot | translate }}</td>
                    <td>
                      <cdf-badge
                        [variant]="rarityVariant[it.rarity]"
                        [subtle]="true"
                        >{{
                          'admin.items.rarities.' + it.rarity | translate
                        }}</cdf-badge
                      >
                    </td>
                    <td class="num">{{ it.costCoins | locale: 'number' }}</td>
                    <td class="num">{{ it.requiredLevel }}</td>
                    <td class="small">
                      @if (it.isLimitedDrop) {
                        {{
                          it.dropStartsAt
                            ? (it.dropStartsAt | locale: 'datetime')
                            : '…'
                        }}
                        →
                        {{
                          it.dropEndsAt
                            ? (it.dropEndsAt | locale: 'datetime')
                            : '…'
                        }}
                      } @else {
                        <span class="muted">{{
                          'admin.common.none' | translate
                        }}</span>
                      }
                    </td>
                    <td>
                      <div class="row-actions">
                        <cdf-button
                          kind="ghost"
                          size="sm"
                          (click)="startEdit(it)"
                        >
                          {{ 'admin.common.edit' | translate }}
                        </cdf-button>
                        <cdf-icon-button
                          icon="trash"
                          size="sm"
                          kind="danger"
                          [ariaLabel]="
                            'admin.items.deleteAria'
                              | translate: { name: it.name }
                          "
                          (click)="remove(it)"
                        />
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    </div>

    <cdf-drawer
      [(open)]="drawerOpen"
      size="lg"
      [title]="(form.id ? 'admin.items.edit' : 'admin.items.new') | translate"
    >
      <div class="editor">
        <div class="form-grid">
          <cdf-form-field
            [label]="'admin.common.name' | translate"
            controlId="item-name"
            [error]="errors()['name'] ?? null"
          >
            <cdf-input
              inputId="item-name"
              [(ngModel)]="form.name"
              (ngModelChange)="bump()"
            />
          </cdf-form-field>
          <cdf-form-field
            [label]="'admin.common.slug' | translate"
            controlId="item-slug"
            [error]="errors()['slug'] ?? null"
          >
            <cdf-input
              inputId="item-slug"
              [(ngModel)]="form.slug"
              data-testid="item-slug"
            />
          </cdf-form-field>
          <cdf-form-field
            class="span-all"
            [label]="'admin.common.description' | translate"
            controlId="item-desc"
          >
            <cdf-input inputId="item-desc" [(ngModel)]="form.description" />
          </cdf-form-field>
          <cdf-form-field
            [label]="'admin.items.slot' | translate"
            controlId="item-slot"
          >
            <cdf-select
              inputId="item-slot"
              [options]="slotOptions()"
              [(ngModel)]="form.slot"
              (ngModelChange)="bump()"
            />
          </cdf-form-field>
          <cdf-form-field
            [label]="'admin.items.category' | translate"
            controlId="item-cat"
            [error]="errors()['categorySlug'] ?? null"
          >
            <cdf-select
              inputId="item-cat"
              [options]="categoryOptions()"
              [(ngModel)]="form.categorySlug"
            />
          </cdf-form-field>
          <cdf-form-field
            [label]="'admin.items.rarity' | translate"
            controlId="item-rarity"
          >
            <cdf-select
              inputId="item-rarity"
              [options]="rarityOptions()"
              [(ngModel)]="form.rarity"
              (ngModelChange)="bump()"
            />
          </cdf-form-field>
          <cdf-form-field
            [label]="'admin.items.cost' | translate"
            controlId="item-cost"
          >
            <cdf-input
              inputId="item-cost"
              type="number"
              [(ngModel)]="form.costCoins"
              (ngModelChange)="bump()"
            />
          </cdf-form-field>
          <cdf-form-field
            [label]="'admin.items.level' | translate"
            controlId="item-level"
          >
            <cdf-input
              inputId="item-level"
              type="number"
              [(ngModel)]="form.requiredLevel"
              (ngModelChange)="bump()"
            />
          </cdf-form-field>
          <cdf-toggle
            [(ngModel)]="form.isPremiumOnly"
            (ngModelChange)="bump()"
            [label]="'admin.items.premiumOnly' | translate"
          />
          <cdf-toggle
            [(ngModel)]="form.isActive"
            [label]="'admin.common.active' | translate"
          />
        </div>

        <fieldset class="group">
          <legend>{{ 'admin.items.sprite' | translate }}</legend>
          <cdf-radio-group
            [options]="spriteModeOptions()"
            [(ngModel)]="form.spriteMode"
            (ngModelChange)="bump()"
            [ariaLabel]="'admin.items.spriteSource' | translate"
          />
          @switch (form.spriteMode) {
            @case ('asset') {
              <cdf-asset-picker
                kind="SPRITE"
                accept="image/png,image/webp"
                [(ngModel)]="form.sprite"
                (ngModelChange)="bump()"
                [placeholder]="'admin.items.noSprite' | translate"
              />
              <p class="muted small">
                {{ 'admin.items.spriteHelp' | translate }}
              </p>
            }
            @case ('emoji') {
              <cdf-form-field
                [label]="'admin.items.emoji' | translate"
                controlId="item-emoji"
              >
                <cdf-input
                  inputId="item-emoji"
                  [(ngModel)]="form.emoji"
                  (ngModelChange)="bump()"
                  data-testid="item-sprite"
                />
              </cdf-form-field>
            }
            @case ('color') {
              <cdf-form-field
                [label]="'admin.items.color' | translate"
                controlId="item-color"
              >
                <input
                  id="item-color"
                  type="color"
                  class="form-control form-control-color"
                  [(ngModel)]="form.color"
                  (ngModelChange)="bump()"
                />
              </cdf-form-field>
            }
          }
          @if (errors()['sprite']; as e) {
            <p class="form-error" role="alert">{{ e }}</p>
          }
        </fieldset>

        <div class="preview-row">
          <cdf-item-sprite-preview [item]="preview()" [size]="160" />
          @if (form.spriteMode === 'asset' && form.sprite) {
            <figure class="sprite-figure">
              <img
                [src]="form.sprite.url"
                [alt]="'admin.items.spriteAlt' | translate: { name: form.name }"
              />
              <figcaption class="muted small">
                {{ 'admin.items.uploadedSprite' | translate }}
              </figcaption>
            </figure>
          }
        </div>

        <fieldset class="group">
          <legend>{{ 'admin.items.limitedDrop' | translate }}</legend>
          <cdf-toggle
            [(ngModel)]="form.isLimitedDrop"
            [label]="'admin.items.isLimitedDrop' | translate"
          />
          @if (form.isLimitedDrop) {
            <cdf-date-range-picker
              [withTime]="true"
              [legend]="'admin.items.dropWindow' | translate"
              [(ngModel)]="form.drop"
            />
          }
        </fieldset>
        @if (formError(); as e) {
          <p class="form-error" role="alert">{{ e }}</p>
        }
      </div>
      <div drawerFooter class="form-actions">
        <cdf-button
          kind="primary"
          [loading]="busy() === 'item'"
          (click)="save()"
          data-testid="save-item"
        >
          {{
            (form.id ? 'admin.common.saveChanges' : 'admin.common.create')
              | translate
          }}
        </cdf-button>
        <cdf-button kind="ghost" (click)="drawerOpen.set(false)">
          {{ 'admin.common.cancel' | translate }}
        </cdf-button>
      </div>
    </cdf-drawer>
  `,
  styles: [
    `
      .cat-form {
        margin-top: var(--cdf-space-3);
        align-items: end;
      }
      .sprite-cell {
        font-size: 24px;
        width: 48px;
      }
      .swatch {
        display: inline-block;
        width: 28px;
        height: 28px;
        border-radius: 6px;
        border: 1px solid var(--cdf-color-border);
      }
      .editor {
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-3);
      }
      .group {
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
        padding: var(--cdf-space-3);
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-2);
        legend {
          font-size: var(--cdf-font-size-sm);
          font-weight: 600;
          padding: 0 4px;
          width: auto;
          float: none;
          margin: 0;
        }
      }
      .preview-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cdf-space-3);
        align-items: flex-start;
      }
      .sprite-figure {
        margin: 0;
        img {
          width: 96px;
          height: 96px;
          object-fit: contain;
          border: 1px solid var(--cdf-color-border);
          border-radius: var(--cdf-radius-sm);
        }
      }
    `,
  ],
})
export class ItemsPage {
  private readonly client = inject(ItemsClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);

  protected readonly rarityVariant = RARITY_VARIANT;
  protected readonly items = signal<Item[]>([]);
  protected readonly categories = signal<ItemCategory[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal<string | null>(null);
  protected readonly drawerOpen = signal(false);
  protected readonly errors = signal<Record<string, string | undefined>>({});
  protected readonly formError = signal<string | null>(null);
  private readonly version = signal(0);
  protected form: ItemForm = this.emptyForm();
  protected newCategory = { slug: '', name: '' };

  protected readonly slotOptions = computed<SelectOption<ItemSlot>[]>(() => {
    this.i18n.currentLocale();
    return SLOTS.map((s) => ({
      value: s,
      label: this.i18n.t(`admin.items.slots.${s}`),
    }));
  });
  protected readonly rarityOptions = computed<SelectOption<ItemRarity>[]>(
    () => {
      this.i18n.currentLocale();
      return RARITIES.map((r) => ({
        value: r,
        label: this.i18n.t(`admin.items.rarities.${r}`),
      }));
    },
  );
  protected readonly categoryOptions = computed<SelectOption<string>[]>(() =>
    this.categories().map((c) => ({ value: c.slug, label: c.name })),
  );
  protected readonly spriteModeOptions = computed<RadioOption<SpriteMode>[]>(
    () => {
      this.i18n.currentLocale();
      return (['asset', 'emoji', 'color'] as const).map((m) => ({
        value: m,
        label: this.i18n.t(`admin.items.spriteModes.${m}`),
      }));
    },
  );

  protected readonly preview = computed<PreviewItem>(() => {
    this.version();
    const f = this.form;
    return {
      name: f.name || this.i18n.t('admin.items.unnamed'),
      slot: f.slot,
      rarity: f.rarity,
      spriteAssetId: spriteRefOf(f),
      costCoins: Number(f.costCoins) || 0,
      requiredLevel: Number(f.requiredLevel) || 1,
      isPremiumOnly: f.isPremiumOnly,
    };
  });

  constructor() {
    void this.refresh();
  }

  private emptyForm(): ItemForm {
    return {
      id: null,
      slug: '',
      name: '',
      description: '',
      slot: 'HAT',
      categorySlug: this.categories?.()[0]?.slug ?? '',
      rarity: 'COMMON',
      costCoins: 100,
      requiredLevel: 1,
      isPremiumOnly: false,
      isLimitedDrop: false,
      drop: { start: null, end: null },
      isActive: true,
      spriteMode: 'emoji',
      sprite: null,
      emoji: '🎩',
      color: '#88ccff',
    };
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const [items, cats] = await Promise.all([
        this.client.listItems(),
        this.client.listCategories(),
      ]);
      this.items.set(items);
      this.categories.set(cats);
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    } finally {
      this.loading.set(false);
    }
  }

  protected spriteKind(ref: string): 'emoji' | 'color' | 'url' {
    if (ref.startsWith('emoji:')) return 'emoji';
    if (ref.startsWith('color:')) return 'color';
    return 'url';
  }

  protected bump(): void {
    this.version.update((v) => v + 1);
  }

  protected startCreate(): void {
    this.form = this.emptyForm();
    this.errors.set({});
    this.formError.set(null);
    this.bump();
    this.drawerOpen.set(true);
  }

  protected startEdit(it: Item): void {
    const s = parseSpriteRef(it.spriteAssetId);
    this.form = {
      id: it.id,
      slug: it.slug,
      name: it.name,
      description: it.description ?? '',
      slot: it.slot,
      categorySlug: it.categorySlug,
      rarity: it.rarity,
      costCoins: it.costCoins,
      requiredLevel: it.requiredLevel,
      isPremiumOnly: it.isPremiumOnly,
      isLimitedDrop: it.isLimitedDrop,
      drop: {
        start: isoToLocal(it.dropStartsAt),
        end: isoToLocal(it.dropEndsAt),
      },
      isActive: it.isActive,
      spriteMode: s.mode,
      sprite: s.url
        ? {
            id: s.url,
            url: s.url,
            kind: 'SPRITE',
            mimeType: 'image/png',
            sizeBytes: 0,
          }
        : null,
      emoji: s.emoji,
      color: s.color,
    };
    this.errors.set({});
    this.formError.set(null);
    this.bump();
    this.drawerOpen.set(true);
  }

  protected async save(): Promise<void> {
    const f = this.form;
    const errs: Record<string, string> = {};
    if (!f.name.trim()) errs['name'] = this.i18n.t('admin.common.required');
    if (!SLUG_PATTERN.test(f.slug.trim()))
      errs['slug'] = this.i18n.t('admin.common.invalidSlug');
    if (!f.categorySlug)
      errs['categorySlug'] = this.i18n.t('admin.common.required');
    const sprite = spriteRefOf(f);
    if (!sprite || sprite === 'emoji:' || sprite === 'color:')
      errs['sprite'] = this.i18n.t('admin.items.spriteRequired');
    if (
      f.isLimitedDrop &&
      f.drop.start &&
      f.drop.end &&
      f.drop.end < f.drop.start
    )
      errs['sprite'] = this.i18n.t('admin.items.dropOrder');
    this.errors.set(errs);
    if (Object.keys(errs).length) return;

    const body: CreateItemBody = {
      slug: f.slug.trim(),
      name: f.name.trim(),
      description: f.description.trim() || undefined,
      slot: f.slot,
      categorySlug: f.categorySlug,
      rarity: f.rarity,
      costCoins: Math.max(0, Math.round(Number(f.costCoins) || 0)),
      requiredLevel: Math.max(1, Math.round(Number(f.requiredLevel) || 1)),
      isPremiumOnly: f.isPremiumOnly,
      isLimitedDrop: f.isLimitedDrop,
      dropStartsAt: f.isLimitedDrop ? localToIso(f.drop.start) : null,
      dropEndsAt: f.isLimitedDrop ? localToIso(f.drop.end) : null,
      spriteAssetId: sprite,
      isActive: f.isActive,
    };
    this.busy.set('item');
    this.formError.set(null);
    try {
      if (f.id) {
        const updated = await this.client.updateItem(f.id, body);
        this.items.update((xs) =>
          xs.map((x) => (x.id === updated.id ? updated : x)),
        );
      } else {
        const created = await this.client.createItem(body);
        this.items.update((xs) => [created, ...xs]);
      }
      this.toast.success(this.i18n.t('admin.items.saved', { name: body.name }));
      this.drawerOpen.set(false);
    } catch (err) {
      this.formError.set(
        this.errorsSvc.message(err, 'admin.errors.saveFailed'),
      );
    } finally {
      this.busy.set(null);
    }
  }

  protected async remove(it: Item): Promise<void> {
    const ok = await this.confirm.open({
      title: this.i18n.t('admin.common.deleteConfirmTitle', { name: it.name }),
      message: this.i18n.t('admin.items.deleteMessage'),
      confirmLabel: this.i18n.t('admin.common.delete'),
      confirmKind: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    try {
      await this.client.deleteItem(it.id);
      this.items.update((xs) => xs.filter((x) => x.id !== it.id));
      this.toast.success(this.i18n.t('admin.items.deleted', { name: it.name }));
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.deleteFailed');
    }
  }

  protected async addCategory(): Promise<void> {
    const slug = this.newCategory.slug.trim();
    const name = this.newCategory.name.trim();
    if (!SLUG_PATTERN.test(slug) || !name) {
      this.toast.error(this.i18n.t('admin.items.categoryInvalid'));
      return;
    }
    this.busy.set('category');
    try {
      const created = await this.client.createCategory({ slug, name });
      this.categories.update((cs) => [...cs, created]);
      this.newCategory = { slug: '', name: '' };
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.saveFailed');
    } finally {
      this.busy.set(null);
    }
  }
}
