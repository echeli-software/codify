import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18nService, LocalePipe, TranslatePipe } from '@codify/i18n';
import {
  Badge,
  Button,
  Combobox,
  type ComboboxOption,
  type ComboboxSource,
  FormField,
} from '@codify/ui-bootstrap';
import {
  AdminCatalogClient,
  CoursesClient,
  UsersClient,
  type MultiplierPreview,
  type MultiplierPreviewDimension,
} from '@codify/api-client';
import { AdminErrors } from '../core/errors';
import { localToIso } from '../core/catalog';

/** `PREMIUM_DEFAULT ×1.5 · COURSE_PROMO ×2` → labelled factors. */
export function breakdownText(
  d: Pick<MultiplierPreviewDimension, 'components' | 'effective'>,
  label: (kind: string) => string,
): string {
  if (d.components.length === 0) return `×${d.effective}`;
  return `${d.components
    .map((c) => `${label(c.kind)} ×${c.value}`)
    .join(' × ')} = ×${d.effective}`;
}

/**
 * Promotions "effective preview" (docs/04): pick a user and a lesson (and
 * optionally a moment), see the resolver breakdown the reward pipeline
 * would apply — e.g. `Premium ×1.5 × Course promo ×2 × Streak ×1.25 =
 * ×3.75` — for XP and coins. Read-only; nothing is awarded.
 */
@Component({
  selector: 'cdf-multiplier-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    Badge,
    Button,
    Combobox,
    FormField,
    TranslatePipe,
    LocalePipe,
  ],
  template: `
    <h2 id="preview-title">
      {{ 'admin.promotions.preview.title' | translate }}
    </h2>
    <p class="muted small">{{ 'admin.promotions.preview.help' | translate }}</p>
    <div class="form-grid form-grid--2">
      <cdf-form-field
        [label]="'admin.promotions.preview.user' | translate"
        controlId="preview-user"
      >
        <cdf-combobox
          inputId="preview-user"
          [source]="searchUsers"
          [minChars]="2"
          [placeholder]="'admin.promotions.preview.userPlaceholder' | translate"
          [ngModel]="userId()"
          (ngModelChange)="userId.set($event)"
        />
      </cdf-form-field>
      <cdf-form-field
        [label]="'admin.promotions.preview.course' | translate"
        controlId="preview-course"
      >
        <cdf-combobox
          inputId="preview-course"
          [options]="courseOptions()"
          [ngModel]="courseId()"
          (ngModelChange)="onCourse($event)"
        />
      </cdf-form-field>
      <cdf-form-field
        [label]="'admin.promotions.preview.lesson' | translate"
        controlId="preview-lesson"
      >
        <cdf-combobox
          inputId="preview-lesson"
          [options]="lessonOptions()"
          [ngModel]="lessonId()"
          (ngModelChange)="lessonId.set($event)"
          [emptyLabel]="'admin.promotions.preview.pickCourse' | translate"
        />
      </cdf-form-field>
      <cdf-form-field
        [label]="'admin.promotions.preview.at' | translate"
        [help]="'admin.promotions.preview.atHelp' | translate"
        controlId="preview-at"
      >
        <input
          id="preview-at"
          class="form-control"
          type="datetime-local"
          [(ngModel)]="at"
        />
      </cdf-form-field>
    </div>
    <div class="form-actions">
      <cdf-button
        kind="primary"
        [disabled]="!userId() || !lessonId()"
        [loading]="loading()"
        (click)="run()"
        data-testid="run-preview"
      >
        {{ 'admin.promotions.preview.run' | translate }}
      </cdf-button>
    </div>
    @if (error(); as e) {
      <p class="form-error" role="alert">{{ e }}</p>
    }
    @if (result(); as r) {
      <div class="result" aria-live="polite" data-testid="preview-result">
        <p class="small">
          {{
            'admin.promotions.preview.context'
              | translate
                : {
                    user: r.user.displayName,
                    lesson: r.lesson.title,
                    streak: r.user.streakDays,
                    at: (r.at | locale: 'datetime'),
                  }
          }}
          @if (r.user.isPremium) {
            <cdf-badge variant="premium" [subtle]="true">{{
              'admin.promotions.preview.premium' | translate
            }}</cdf-badge>
          }
        </p>
        @for (dim of dims(); track dim.key) {
          <div class="dim">
            <strong>{{
              'admin.promotions.preview.' + dim.key | translate
            }}</strong>
            <span class="mono">{{ dim.text }}</span>
            <span>{{
              'admin.promotions.preview.reward'
                | translate: { base: dim.d.base, reward: dim.d.reward }
            }}</span>
            @if (dim.d.capped) {
              <cdf-badge variant="warning" [subtle]="true">{{
                'admin.promotions.preview.capped'
                  | translate: { cap: r.cap, uncapped: dim.d.uncapped }
              }}</cdf-badge>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      .result {
        margin-top: var(--cdf-space-3);
        padding: var(--cdf-space-3);
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-sm);
        background: var(--cdf-color-bg);
      }
      .dim {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cdf-space-2);
        padding: 4px 0;
      }
    `,
  ],
})
export class MultiplierPreviewPanel {
  private readonly client = inject(AdminCatalogClient);
  private readonly users = inject(UsersClient);
  private readonly coursesClient = inject(CoursesClient);
  private readonly errorsSvc = inject(AdminErrors);
  private readonly i18n = inject(I18nService);

  /** Course options (id + title) from the promotions page. */
  readonly courses = input<{ id: string; title: string }[]>([]);

  protected readonly userId = signal<string | null>(null);
  protected readonly courseId = signal<string | null>(null);
  protected readonly lessonId = signal<string | null>(null);
  protected readonly lessonOptions = signal<ComboboxOption<string>[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<MultiplierPreview | null>(null);
  protected at = '';

  protected readonly courseOptions = computed<ComboboxOption<string>[]>(() =>
    this.courses().map((c) => ({ value: c.id, label: c.title })),
  );

  protected readonly dims = computed(() => {
    const r = this.result();
    if (!r) return [];
    const label = (k: string) => this.i18n.t(`admin.promotions.kinds.${k}`);
    return (['xp', 'coins'] as const).map((key) => ({
      key,
      d: r[key],
      text: breakdownText(r[key], label),
    }));
  });

  protected readonly searchUsers: ComboboxSource<string> = async (q) => {
    const res = await this.users.list({ q, take: 8 });
    return res.items.map((u) => ({
      value: u.id,
      label: u.displayName,
      description: u.email,
    }));
  };

  protected async onCourse(id: string | null): Promise<void> {
    this.courseId.set(id);
    this.lessonId.set(null);
    this.lessonOptions.set([]);
    if (!id) return;
    try {
      const c = await this.coursesClient.detail(id);
      if (this.courseId() !== id) return;
      this.lessonOptions.set(
        c.modules.flatMap((m) =>
          m.lessons.map((l) => ({
            value: l.id,
            label: l.title,
            description: m.title,
          })),
        ),
      );
    } catch (err) {
      this.errorsSvc.toast(err, 'admin.errors.loadFailed');
    }
  }

  protected async run(): Promise<void> {
    const userId = this.userId();
    const lessonId = this.lessonId();
    if (!userId || !lessonId) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      this.result.set(
        await this.client.previewMultiplier({
          userId,
          lessonId,
          at: localToIso(this.at) ?? undefined,
        }),
      );
    } catch (err) {
      this.result.set(null);
      this.error.set(this.errorsSvc.message(err, 'admin.errors.loadFailed'));
    } finally {
      this.loading.set(false);
    }
  }
}
