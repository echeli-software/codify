import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  Badge,
  Button,
  ConfirmDialogService,
  FormField,
  Icon,
  Input,
  Select,
  type SelectOption,
  ToastService,
} from '@codify/ui-bootstrap';
import {
  ItemsClient,
  ProblemDetailsError,
  type Item,
  type ItemCategory,
  type ItemRarity,
  type ItemSlot,
} from '@codify/api-client';

const SLOTS: ItemSlot[] = ['PET', 'BACKGROUND', 'TOP', 'BOTTOM', 'SHOES', 'HAT', 'HAIR', 'GLASSES', 'ACCESSORY', 'FRAME', 'EMOTE'];
const RARITIES: ItemRarity[] = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Badge, Button, FormField, Icon, Input, Select],
  template: `
    <header class="page-header">
      <div>
        <h1>Shop items</h1>
        <p class="text-muted">Cosmetics catalog. Sprites use placeholder tokens (emoji:🧢 / color:#hex) until the asset pipeline lands.</p>
      </div>
    </header>

    <section class="card" data-testid="categories-section">
      <h3>Categories ({{ categories().length }})</h3>
      <div class="row-form">
        <cdf-form-field label="Slug"><cdf-input [(ngModel)]="cf.slug" data-testid="cat-slug" /></cdf-form-field>
        <cdf-form-field label="Name"><cdf-input [(ngModel)]="cf.name" /></cdf-form-field>
        <cdf-button kind="primary" size="sm" (click)="addCategory()" data-testid="add-cat-btn">Add category</cdf-button>
      </div>
      <div class="chips">
        @for (c of categories(); track c.slug) { <cdf-badge variant="neutral" [subtle]="true">{{ c.name }}</cdf-badge> }
      </div>
    </section>

    <section class="card" data-testid="items-section">
      <h3>Items ({{ items().length }})</h3>
      <ul class="rows">
        @for (it of items(); track it.id) {
        <li [attr.data-item-id]="it.id">
          <span class="sprite">{{ glyph(it.spriteAssetId) }}</span>
          <span class="grow"><strong>{{ it.name }}</strong> · {{ it.slot }}</span>
          <cdf-badge [variant]="rarityVariant(it.rarity)" [subtle]="true">{{ it.rarity }}</cdf-badge>
          <span class="muted">{{ it.costCoins }}c · L{{ it.requiredLevel }}</span>
          @if (it.isPremiumOnly) { <cdf-badge variant="info" [subtle]="true">premium</cdf-badge> }
          <cdf-button kind="danger" size="sm" (click)="removeItem(it)">Delete</cdf-button>
        </li>
        }
      </ul>
      <div class="form-grid">
        <cdf-form-field label="Slug"><cdf-input [(ngModel)]="f.slug" data-testid="item-slug" /></cdf-form-field>
        <cdf-form-field label="Name"><cdf-input [(ngModel)]="f.name" /></cdf-form-field>
        <cdf-form-field label="Slot"><cdf-select [options]="slotOptions" [(ngModel)]="f.slot" /></cdf-form-field>
        <cdf-form-field label="Category"><cdf-select [options]="categoryOptions()" [(ngModel)]="f.categorySlug" /></cdf-form-field>
        <cdf-form-field label="Rarity"><cdf-select [options]="rarityOptions" [(ngModel)]="f.rarity" /></cdf-form-field>
        <cdf-form-field label="Cost (coins)"><cdf-input type="number" [(ngModel)]="f.costCoins" /></cdf-form-field>
        <cdf-form-field label="Required level"><cdf-input type="number" [(ngModel)]="f.requiredLevel" /></cdf-form-field>
        <cdf-form-field label="Sprite token"><cdf-input [(ngModel)]="f.spriteAssetId" placeholder="emoji:🧢" data-testid="item-sprite" /></cdf-form-field>
        <cdf-button kind="primary" [loading]="saving()" (click)="addItem()" data-testid="add-item-btn">Add item</cdf-button>
      </div>
      @if (formError()) { <p class="form-error">{{ formError() }}</p> }
    </section>
  `,
  styles: [
    `
      :host { display: block; max-width: 1100px; margin: 0 auto; }
      .page-header { margin-bottom: var(--cdf-space-4); h1 { margin: 0; font-size: var(--cdf-font-size-xl); } p { margin: 4px 0 0; } }
      .card { background: var(--cdf-color-surface); border: 1px solid var(--cdf-color-border); border-radius: var(--cdf-radius-md); padding: var(--cdf-space-4); margin-bottom: var(--cdf-space-4);
        h3 { margin: 0 0 var(--cdf-space-3); font-size: var(--cdf-font-size-md); } }
      .row-form { display: grid; grid-template-columns: 1fr 1fr auto; gap: var(--cdf-space-2); align-items: end; margin-bottom: var(--cdf-space-2); }
      .chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .rows { list-style: none; padding: 0; margin: 0 0 var(--cdf-space-3); display: flex; flex-direction: column; gap: 6px;
        li { display: flex; align-items: center; gap: var(--cdf-space-2); } }
      .sprite { font-size: 20px; width: 24px; text-align: center; }
      .grow { flex: 1; }
      .muted { color: var(--cdf-color-text-muted); font-size: 13px; }
      .form-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--cdf-space-2); align-items: end; }
      .form-error { margin-top: var(--cdf-space-2); color: var(--cdf-color-danger); font-size: 13px; }
    `,
  ],
})
export class ItemsPage {
  private readonly client = inject(ItemsClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);

  protected readonly categories = signal<ItemCategory[]>([]);
  protected readonly items = signal<Item[]>([]);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected cf = { slug: '', name: '' };
  protected f = { slug: '', name: '', slot: 'HAT' as ItemSlot, categorySlug: '', rarity: 'COMMON' as ItemRarity, costCoins: 100, requiredLevel: 1, spriteAssetId: 'emoji:🧢' };

  protected readonly slotOptions: SelectOption<ItemSlot>[] = SLOTS.map((s) => ({ value: s, label: s }));
  protected readonly rarityOptions: SelectOption<ItemRarity>[] = RARITIES.map((r) => ({ value: r, label: r }));
  protected categoryOptions(): SelectOption<string>[] {
    return this.categories().map((c) => ({ value: c.slug, label: c.name }));
  }

  constructor() {
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const [cats, items] = await Promise.all([this.client.listCategories(), this.client.listItems()]);
      this.categories.set(cats);
      this.items.set(items);
      if (!this.f.categorySlug && cats[0]) this.f.categorySlug = cats[0].slug;
    } catch (err) {
      this.toast.error(this.describe(err, 'Failed to load items'));
    }
  }

  protected async addCategory(): Promise<void> {
    try {
      const created = await this.client.createCategory({ slug: this.cf.slug.trim(), name: this.cf.name.trim() });
      this.categories.update((rs) => [...rs, created]);
      if (!this.f.categorySlug) this.f.categorySlug = created.slug;
      this.cf = { slug: '', name: '' };
      this.toast.success(`Category "${created.name}" added`);
    } catch (err) {
      this.toast.error(this.describe(err, 'Add category failed'));
    }
  }

  protected async addItem(): Promise<void> {
    this.formError.set(null);
    if (!this.f.categorySlug) {
      this.formError.set('Create a category first');
      return;
    }
    this.saving.set(true);
    try {
      const created = await this.client.createItem({
        slug: this.f.slug.trim(),
        name: this.f.name.trim(),
        slot: this.f.slot,
        categorySlug: this.f.categorySlug,
        rarity: this.f.rarity,
        costCoins: Number(this.f.costCoins),
        requiredLevel: Number(this.f.requiredLevel),
        spriteAssetId: this.f.spriteAssetId.trim(),
      });
      this.items.update((rs) => [created, ...rs]);
      this.toast.success(`Item "${created.name}" added`);
    } catch (err) {
      this.formError.set(this.describe(err, 'Add item failed'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async removeItem(it: Item): Promise<void> {
    if (!(await this.confirm.open({ title: `Delete "${it.name}"?`, message: 'The item is soft-deleted; existing owners keep it.', confirmLabel: 'Delete', confirmKind: 'danger' }))) return;
    try {
      await this.client.deleteItem(it.id);
      this.items.update((rs) => rs.filter((x) => x.id !== it.id));
    } catch (err) {
      this.toast.error(this.describe(err, 'Delete failed'));
    }
  }

  protected glyph(token: string): string {
    return token.startsWith('emoji:') ? token.slice(6) : '🎨';
  }
  protected rarityVariant(r: string): 'neutral' | 'info' | 'success' | 'warning' {
    if (r === 'LEGENDARY' || r === 'EPIC') return 'warning';
    if (r === 'RARE') return 'info';
    if (r === 'UNCOMMON') return 'success';
    return 'neutral';
  }

  private describe(err: unknown, fallback: string): string {
    if (err instanceof ProblemDetailsError) {
      if (err.isForbidden) return 'Admins only.';
      if (err.status === 409) return 'That slug is already in use.';
      if (err.status === 400) return err.message || 'Invalid input.';
      if (err.message) return err.message;
    }
    return fallback;
  }
}
