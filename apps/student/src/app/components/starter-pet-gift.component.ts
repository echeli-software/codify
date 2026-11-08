import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@codify/auth';
import {
  ItemsClient,
  type AvatarResponse,
  type StarterPetStatus,
} from '@codify/api-client';
import { TranslatePipe } from '@codify/i18n';
import {
  AppButton,
  AppInput,
  BottomSheet,
  FormField,
  ItemSprite,
} from '@codify/ui-ionic';
import { NetworkStatusService } from '../offline/network-status.service.js';
import { AppToastService } from '../platform/app-toast.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';

const DISMISS_KEY = 'codify.starterPet.later.';

/**
 * The onboarding "first reward" (docs/05 Onboarding step 6, docs/10 §2):
 * once the first lesson is done, the free starter pet is unlocked and the
 * learner is invited to name it. Shown on Today; "Not now" hides it for
 * this session only (the gift stays claimable). Opening it equips the pet
 * when no other pet is out.
 */
@Component({
  selector: 'cdf-starter-pet-gift',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    AppButton,
    AppInput,
    BottomSheet,
    FormField,
    ItemSprite,
    TranslatePipe,
  ],
  template: `
    @if (gift(); as g) {
      <cdf-bottom-sheet
        [open]="open()"
        (openChange)="onOpenChange($event)"
        [title]="'student.starterPet.title' | translate"
      >
        <form
          class="gift"
          data-testid="starter-pet-gift"
          (submit)="claim($event)"
        >
          @if (g.item; as item) {
            <div class="gift__pet" aria-hidden="true">
              <cdf-item-sprite
                [token]="item.spriteAssetId"
                [url]="item.spriteUrl"
                [size]="96"
              />
            </div>
            <p class="gift__lead">
              {{ 'student.starterPet.body' | translate: { pet: item.name } }}
            </p>
          }
          <cdf-form-field
            [label]="'student.starterPet.nameLabel' | translate"
            [help]="'student.starterPet.nameHint' | translate"
          >
            <cdf-app-input
              name="petName"
              [(ngModel)]="name"
              [maxLength]="30"
              data-testid="starter-pet-name"
            />
          </cdf-form-field>
          <div class="gift__actions">
            <cdf-app-button kind="ghost" (buttonClick)="later()">
              {{ 'student.starterPet.later' | translate }}
            </cdf-app-button>
            <cdf-app-button
              kind="primary"
              [loading]="claiming()"
              (buttonClick)="claim()"
              data-testid="starter-pet-claim"
            >
              {{ 'student.starterPet.claim' | translate }}
            </cdf-app-button>
          </div>
        </form>
      </cdf-bottom-sheet>
    }
  `,
  styles: [
    `
      .gift {
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-3);
      }
      .gift__pet {
        align-self: center;
        width: 128px;
        height: 128px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--cdf-color-primary-subtle, rgba(91, 141, 239, 0.12));
      }
      .gift__lead {
        margin: 0;
        text-align: center;
        font-size: var(--cdf-font-size-md);
      }
      .gift__actions {
        display: flex;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: var(--cdf-space-2);
      }
    `,
  ],
})
export class StarterPetGiftComponent {
  private readonly items = inject(ItemsClient);
  private readonly auth = inject(AuthService);
  private readonly network = inject(NetworkStatusService);
  private readonly toast = inject(AppToastService);
  private readonly telemetry = inject(TelemetryService);

  /** The pet was given (the avatar now wears it). */
  readonly claimed = output<AvatarResponse>();

  protected readonly gift = signal<StarterPetStatus | null>(null);
  protected readonly open = signal(false);
  protected readonly claiming = signal(false);
  protected name = '';

  constructor() {
    void this.check();
  }

  private dismissKey(): string | null {
    const id = this.auth.user()?.id;
    return id ? DISMISS_KEY + id : null;
  }

  private async check(): Promise<void> {
    if (this.auth.role() !== 'STUDENT' || !this.network.online()) return;
    const key = this.dismissKey();
    try {
      if (key && sessionStorage.getItem(key)) return;
    } catch {
      /* storage unavailable */
    }
    try {
      const status = await this.items.starterPet();
      if (!status.eligible) return;
      this.gift.set(status);
      this.open.set(true);
      this.telemetry.track('starter_pet_offered');
    } catch {
      // Not critical: the gift is offered again next time.
    }
  }

  protected onOpenChange(open: boolean): void {
    if (!open && this.open()) this.later();
  }

  protected later(): void {
    this.open.set(false);
    const key = this.dismissKey();
    try {
      if (key) sessionStorage.setItem(key, '1');
    } catch {
      /* storage unavailable */
    }
  }

  protected async claim(ev?: Event): Promise<void> {
    ev?.preventDefault();
    if (this.claiming()) return;
    this.claiming.set(true);
    try {
      const res = await this.items.claimStarterPet(
        this.name.trim() || undefined,
      );
      this.open.set(false);
      this.telemetry.track('starter_pet_claimed', {
        itemId: res.item?.id ?? null,
        named: !!res.petName,
      });
      this.toast.show({
        message: 'student.starterPet.claimed',
        kind: 'success',
        params: { pet: res.petName ?? res.item?.name ?? '' },
      });
      this.claimed.emit(res.avatar);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.claiming.set(false);
    }
  }
}
