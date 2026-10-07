import {
  Component,
  ChangeDetectionStrategy,
  computed,
  forwardRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslatePipe } from '@codify/i18n';
import { Button } from '../../atoms/button/button.js';
import { Icon } from '../../atoms/icon/icon.js';
import { ModalFrame } from '../../organisms/modal/modal-frame.js';
import { applyModalInputs } from '../../organisms/modal/modal.service.js';
import {
  ASSET_LIBRARY,
  type AssetKind,
  type AssetSummary,
} from '../../organisms/media-library/asset-library.token.js';
import {
  MediaLibrary,
  assetDisplayName,
} from '../../organisms/media-library/media-library.js';

/** Modal body used by `cdf-asset-picker` (exported for custom openers). */
@Component({
  selector: 'cdf-asset-picker-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalFrame, MediaLibrary, Button, TranslatePipe],
  template: `
    <cdf-modal-frame [title]="'ui.assetPicker.dialogTitle' | translate">
      <cdf-media-library
        [kind]="kind()"
        [accept]="accept()"
        [(selectedId)]="selectedId"
        (selectedChange)="current.set($event)"
        (picked)="modal.close($event)"
      />
      <div modalFooter>
        <cdf-button kind="ghost" (click)="modal.dismiss('cancel')">{{
          'common.cancel' | translate
        }}</cdf-button>
        <cdf-button
          kind="primary"
          [disabled]="!current()"
          (click)="modal.close(current())"
        >
          {{ 'ui.assetPicker.use' | translate }}
        </cdf-button>
      </div>
    </cdf-modal-frame>
  `,
})
export class AssetPickerDialog {
  protected readonly modal = inject(NgbActiveModal);
  readonly kind = input<AssetKind | null>(null);
  readonly accept = input<string | null>('image/*');
  readonly selectedId = signal<string | null>(null);
  protected readonly current = signal<AssetSummary | null>(null);
}

/**
 * Inline asset field: shows the chosen asset's thumbnail + name with
 * "Choose…" / "Remove" actions; "Choose…" opens the MediaLibrary in a modal.
 * Value (ngModel / formControl) is the `AssetSummary` or `null`.
 *
 *   <cdf-asset-picker kind="COVER" [(ngModel)]="cover" />
 */
@Component({
  selector: 'cdf-asset-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Icon, TranslatePipe],
  template: `
    <div class="cdf-asset-picker" [class.cdf-asset-picker--empty]="!value()">
      <div class="cdf-asset-picker__preview">
        @if (value(); as a) {
          @if (isImage(a)) {
            <img [src]="a.url" [alt]="name()" />
          } @else {
            <cdf-icon name="file" size="lg" />
          }
        } @else {
          <cdf-icon name="image" size="lg" />
        }
      </div>
      <div class="cdf-asset-picker__meta">
        <span class="cdf-asset-picker__name">
          {{
            value()
              ? name()
              : (placeholder() ?? ('ui.assetPicker.none' | translate))
          }}
        </span>
        <div class="cdf-asset-picker__actions">
          <cdf-button
            kind="secondary"
            size="sm"
            [disabled]="disabled()"
            (click)="openLibrary()"
          >
            {{
              (value() ? 'ui.assetPicker.change' : 'ui.assetPicker.choose')
                | translate
            }}
          </cdf-button>
          @if (value()) {
            <cdf-button
              kind="ghost"
              size="sm"
              [disabled]="disabled()"
              (click)="clear()"
            >
              {{ 'common.remove' | translate }}
            </cdf-button>
          }
        </div>
      </div>
    </div>
  `,
  styleUrl: './asset-picker.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AssetPicker),
      multi: true,
    },
  ],
})
export class AssetPicker implements ControlValueAccessor {
  private readonly modal = inject(NgbModal);
  private readonly hasLibrary =
    inject(ASSET_LIBRARY, { optional: true }) !== null;

  readonly kind = input<AssetKind | null>(null);
  readonly accept = input<string | null>('image/*');
  readonly placeholder = input<string | null>(null);
  readonly assetChange = output<AssetSummary | null>();

  protected readonly value = signal<AssetSummary | null>(null);
  protected readonly disabled = signal(false);
  protected readonly name = computed(() => {
    const v = this.value();
    return v ? assetDisplayName(v) : '';
  });

  private onChange: (v: AssetSummary | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(v: AssetSummary | null | undefined): void {
    this.value.set(v ?? null);
  }
  registerOnChange(fn: (v: AssetSummary | null) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.disabled.set(d);
  }

  protected isImage(a: AssetSummary): boolean {
    return a.mimeType.startsWith('image/');
  }

  async openLibrary(): Promise<void> {
    if (!this.hasLibrary) return;
    const ref = this.modal.open(AssetPickerDialog, {
      size: 'xl',
      centered: true,
      scrollable: true,
    });
    applyModalInputs(AssetPickerDialog, ref, {
      kind: this.kind(),
      accept: this.accept(),
    });
    const dialog = ref.componentInstance as AssetPickerDialog;
    dialog.selectedId.set(this.value()?.id ?? null);
    try {
      const picked = (await ref.result) as AssetSummary | null;
      if (picked) this.set(picked);
    } catch {
      /* dismissed */
    } finally {
      this.onTouched();
    }
  }

  protected clear(): void {
    this.set(null);
    this.onTouched();
  }

  private set(v: AssetSummary | null): void {
    this.value.set(v);
    this.onChange(v);
    this.assetChange.emit(v);
  }
}
