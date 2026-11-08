import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ItemsClient,
  type InventoryItem,
  type PetNameResponse,
} from '@codify/api-client';
import { TranslatePipe } from '@codify/i18n';
import {
  AppBadge,
  AppButton,
  AppInput,
  FormField,
  ItemSprite,
} from '@codify/ui-ionic';
import { AppToastService } from '../platform/app-toast.service.js';
import { PET_NAME_MAX, ownedPets, petNameChanged } from './pet-names.js';

/**
 * Pet naming in the dressing room (docs/08 §10 "every pet can be named"):
 * one name field per owned pet, saved with `PUT /avatar/pets/:itemId/name`.
 * Emits the response so the page can refresh its avatar and inventory.
 */
@Component({
  selector: 'cdf-pet-names',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    AppBadge,
    AppButton,
    AppInput,
    FormField,
    ItemSprite,
    TranslatePipe,
  ],
  template: `
    @if (pets().length) {
      <section aria-labelledby="pets-title" data-testid="pet-names">
        <h2 id="pets-title">
          {{
            (pets().length > 1
              ? 'student.avatar.petsTitle'
              : 'student.avatar.petTitle'
            ) | translate
          }}
        </h2>
        @if (pets().length > 1) {
          <p class="pets__hint">
            {{ 'student.avatar.petsHint' | translate }}
          </p>
        }
        <ul class="pets">
          @for (p of pets(); track p.item.id) {
            <li class="pets__row" [attr.data-pet]="p.item.id">
              <cdf-item-sprite
                [token]="p.item.spriteAssetId"
                [url]="p.item.spriteUrl"
                [rarity]="p.item.rarity"
                [size]="48"
                aria-hidden="true"
              />
              <form
                class="pets__form"
                (submit)="save($event, p)"
                data-testid="pet-name-form"
              >
                <cdf-form-field
                  class="pets__field"
                  [label]="
                    'student.avatar.petNameFor'
                      | translate: { item: p.item.name }
                  "
                >
                  <cdf-app-input
                    [name]="'pet-' + p.item.id"
                    [ngModel]="draftFor(p)"
                    (ngModelChange)="setDraft(p.item.id, $event)"
                    [maxLength]="maxLength"
                    data-testid="pet-name"
                  />
                </cdf-form-field>
                @if (p.equipped) {
                  <cdf-app-badge variant="primary" [subtle]="true">
                    {{ 'student.avatar.petOut' | translate }}
                  </cdf-app-badge>
                }
                <cdf-app-button
                  kind="secondary"
                  type="submit"
                  [disabled]="disabled() || !changed(p)"
                  [loading]="savingId() === p.item.id"
                >
                  {{ 'common.save' | translate }}
                </cdf-app-button>
              </form>
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: [
    `
      h2 {
        margin: 0 0 var(--cdf-space-2);
        font-size: var(--cdf-font-size-md);
      }
      .pets__hint {
        margin: 0 0 var(--cdf-space-2);
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
      }
      .pets {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-3);
      }
      .pets__row {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: flex-end;
      }
      .pets__form {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        gap: var(--cdf-space-2);
        align-items: flex-end;
        flex-wrap: wrap;
      }
      .pets__field {
        flex: 1 1 200px;
        min-width: 0;
      }
    `,
  ],
})
export class PetNames {
  private readonly items = inject(ItemsClient);
  private readonly toast = inject(AppToastService);

  /** The full inventory (only PET items are shown). */
  readonly inventory = input<InventoryItem[]>([]);
  /** Offline: names can't be saved. */
  readonly disabled = input(false);
  readonly renamed = output<PetNameResponse>();

  protected readonly maxLength = PET_NAME_MAX;
  protected readonly pets = computed(() => ownedPets(this.inventory()));
  private readonly drafts = signal<Record<string, string>>({});
  protected readonly savingId = signal<string | null>(null);

  protected draftFor(p: InventoryItem): string {
    return this.drafts()[p.item.id] ?? p.nickname ?? '';
  }

  protected setDraft(itemId: string, value: string): void {
    this.drafts.update((d) => ({ ...d, [itemId]: value ?? '' }));
  }

  protected changed(p: InventoryItem): boolean {
    return petNameChanged(this.draftFor(p), p.nickname);
  }

  protected async save(ev: Event, p: InventoryItem): Promise<void> {
    ev.preventDefault();
    if (this.disabled() || this.savingId()) return;
    const name = this.draftFor(p).trim();
    this.savingId.set(p.item.id);
    try {
      const res = await this.items.namePet(p.item.id, name || null);
      this.drafts.update((d) => {
        const rest = { ...d };
        delete rest[p.item.id];
        return rest;
      });
      this.renamed.emit(res);
      this.toast.show(
        res.nickname
          ? {
              message: 'student.avatar.petSaved',
              kind: 'success',
              params: { name: res.nickname },
            }
          : { message: 'student.avatar.petCleared', kind: 'success' },
      );
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.savingId.set(null);
    }
  }
}
