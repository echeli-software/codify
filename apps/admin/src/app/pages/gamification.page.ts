import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialogService,
  FormField,
  Icon,
  Input,
  Select,
  type SelectOption,
  Textarea,
  ToastService,
} from '@codify/ui-bootstrap';
import {
  GamificationClient,
  ProblemDetailsError,
  type BadgeDef,
  type Multiplier,
  type MultiplierKind,
  type QuestKind,
  type QuestTemplate,
} from '@codify/api-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Badge, Button, Checkbox, FormField, Icon, Input, Select, Textarea],
  template: `
    <header class="page-header">
      <div>
        <h1>Gamification</h1>
        <p class="text-muted">Quest templates, badges, and multipliers (promotions).</p>
      </div>
    </header>

    <!-- ── Quest templates ──────────────────────────────────────────── -->
    <section class="card" data-testid="quests-section">
      <h3>Quest templates ({{ quests().length }})</h3>
      <ul class="rows">
        @for (q of quests(); track q.id) {
        <li>
          <span class="grow"><strong>{{ q.title }}</strong> · {{ q.kind }} ×{{ q.target }}</span>
          <cdf-badge [variant]="q.isActive ? 'success' : 'neutral'" [subtle]="true">
            {{ q.isActive ? 'active' : 'off' }}
          </cdf-badge>
          <span class="muted">+{{ q.xpReward }}xp/+{{ q.coinReward }}c · d{{ q.difficulty }}</span>
          <cdf-button kind="danger" size="sm" (click)="removeQuest(q)">Delete</cdf-button>
        </li>
        }
      </ul>
      <div class="form-grid">
        <cdf-form-field label="Slug"><cdf-input [(ngModel)]="qf.slug" data-testid="quest-slug" /></cdf-form-field>
        <cdf-form-field label="Title"><cdf-input [(ngModel)]="qf.title" /></cdf-form-field>
        <cdf-form-field label="Kind"><cdf-select [options]="questKinds" [(ngModel)]="qf.kind" /></cdf-form-field>
        <cdf-form-field label="Difficulty"><cdf-select [options]="difficulties" [(ngModel)]="qf.difficulty" /></cdf-form-field>
        <cdf-form-field label="Target"><cdf-input type="number" [(ngModel)]="qf.target" /></cdf-form-field>
        <cdf-form-field label="XP reward"><cdf-input type="number" [(ngModel)]="qf.xpReward" /></cdf-form-field>
        <cdf-form-field label="Coin reward"><cdf-input type="number" [(ngModel)]="qf.coinReward" /></cdf-form-field>
        <cdf-button kind="primary" [loading]="savingQuest()" (click)="addQuest()" data-testid="add-quest-btn">Add quest</cdf-button>
      </div>
    </section>

    <!-- ── Badges ───────────────────────────────────────────────────── -->
    <section class="card" data-testid="badges-section">
      <h3>Badges ({{ badges().length }})</h3>
      <ul class="rows">
        @for (b of badges(); track b.id) {
        <li>
          <span class="grow"><strong>{{ b.name }}</strong> · {{ b.slug }}</span>
          @if (b.isHidden) { <cdf-badge variant="info" [subtle]="true">hidden</cdf-badge> }
          <span class="muted">+{{ b.xpReward }}xp/+{{ b.coinReward }}c</span>
          <cdf-button kind="danger" size="sm" (click)="removeBadge(b)">Delete</cdf-button>
        </li>
        }
      </ul>
      <div class="form-grid">
        <cdf-form-field label="Slug"><cdf-input [(ngModel)]="bf.slug" data-testid="badge-slug" /></cdf-form-field>
        <cdf-form-field label="Name"><cdf-input [(ngModel)]="bf.name" /></cdf-form-field>
        <cdf-form-field label="Icon"><cdf-input [(ngModel)]="bf.iconName" placeholder="trophy" /></cdf-form-field>
        <cdf-form-field label="XP reward"><cdf-input type="number" [(ngModel)]="bf.xpReward" /></cdf-form-field>
        <cdf-form-field label="Coin reward"><cdf-input type="number" [(ngModel)]="bf.coinReward" /></cdf-form-field>
        <cdf-form-field label="Rule (JSON)" class="wide" [error]="ruleError()">
          <cdf-textarea [(ngModel)]="bf.rule" [rows]="2" />
        </cdf-form-field>
        <div class="checkbox-row"><cdf-checkbox [(ngModel)]="bf.isHidden" label="Hidden" /></div>
        <cdf-button kind="primary" [loading]="savingBadge()" (click)="addBadge()" data-testid="add-badge-btn">Add badge</cdf-button>
      </div>
    </section>

    <!-- ── Multipliers / promotions ─────────────────────────────────── -->
    <section class="card" data-testid="multipliers-section">
      <h3>Multipliers ({{ multipliers().length }})</h3>
      <ul class="rows">
        @for (m of multipliers(); track m.id) {
        <li>
          <span class="grow"><strong>{{ m.kind }}</strong> ×{{ m.value }} ({{ m.target }})</span>
          <cdf-badge [variant]="m.isActive ? 'success' : 'neutral'" [subtle]="true">
            {{ m.isActive ? 'active' : 'off' }}
          </cdf-badge>
          @if (m.streakDaysMin) { <span class="muted">≥{{ m.streakDaysMin }}d</span> }
          <cdf-button kind="danger" size="sm" (click)="removeMultiplier(m)">Delete</cdf-button>
        </li>
        }
      </ul>
      <div class="form-grid">
        <cdf-form-field label="Kind"><cdf-select [options]="multiplierKinds" [(ngModel)]="mf.kind" data-testid="mult-kind" /></cdf-form-field>
        <cdf-form-field label="Target"><cdf-select [options]="targets" [(ngModel)]="mf.target" /></cdf-form-field>
        <cdf-form-field label="Value"><cdf-input type="number" [(ngModel)]="mf.value" data-testid="mult-value" /></cdf-form-field>
        <cdf-form-field label="Streak ≥ (tier only)"><cdf-input type="number" [(ngModel)]="mf.streakDaysMin" /></cdf-form-field>
        <cdf-form-field label="Description" class="wide"><cdf-input [(ngModel)]="mf.description" /></cdf-form-field>
        <cdf-button kind="primary" [loading]="savingMult()" (click)="addMultiplier()" data-testid="add-mult-btn">Add multiplier</cdf-button>
      </div>
    </section>
  `,
  styles: [
    `
      :host { display: block; max-width: 1100px; margin: 0 auto; }
      .page-header { margin-bottom: var(--cdf-space-4); h1 { margin: 0; font-size: var(--cdf-font-size-xl); } p { margin: 4px 0 0; } }
      .card { background: var(--cdf-color-surface); border: 1px solid var(--cdf-color-border); border-radius: var(--cdf-radius-md); padding: var(--cdf-space-4); margin-bottom: var(--cdf-space-4);
        h3 { margin: 0 0 var(--cdf-space-3); font-size: var(--cdf-font-size-md); } }
      .rows { list-style: none; padding: 0; margin: 0 0 var(--cdf-space-3); display: flex; flex-direction: column; gap: 6px;
        li { display: flex; align-items: center; gap: var(--cdf-space-2); } }
      .grow { flex: 1; }
      .muted { color: var(--cdf-color-text-muted); font-size: 13px; }
      .form-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--cdf-space-2); align-items: end; }
      .form-grid .wide { grid-column: span 3; }
      .checkbox-row { align-self: center; }
    `,
  ],
})
export class GamificationPage {
  private readonly client = inject(GamificationClient);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);

  protected readonly quests = signal<QuestTemplate[]>([]);
  protected readonly badges = signal<BadgeDef[]>([]);
  protected readonly multipliers = signal<Multiplier[]>([]);
  protected readonly savingQuest = signal(false);
  protected readonly savingBadge = signal(false);
  protected readonly savingMult = signal(false);
  protected readonly ruleError = signal<string | null>(null);

  protected qf = { slug: '', title: '', kind: 'LESSON_COUNT' as QuestKind, difficulty: 1, target: 1, xpReward: 5, coinReward: 5 };
  protected bf = { slug: '', name: '', iconName: 'trophy', xpReward: 10, coinReward: 10, rule: '{ "all": [{ "event": "lesson_complete", "count": { "gte": 1 } }] }', isHidden: false };
  protected mf = { kind: 'CAMPAIGN' as MultiplierKind, target: 'BOTH', value: 2, streakDaysMin: null as number | null, description: '' };

  protected readonly questKinds: SelectOption<QuestKind>[] = [
    { value: 'LESSON_COUNT', label: 'Lesson count' },
    { value: 'CATEGORY_LESSON_COUNT', label: 'Category lesson count' },
    { value: 'XP_AMOUNT', label: 'XP amount' },
    { value: 'STREAK_MAINTAIN', label: 'Streak maintain' },
    { value: 'EXERCISE_PASS', label: 'Exercise pass' },
  ];
  protected readonly difficulties: SelectOption<number>[] = [
    { value: 1, label: 'Easy' },
    { value: 2, label: 'Medium' },
    { value: 3, label: 'Hard' },
  ];
  protected readonly multiplierKinds: SelectOption<MultiplierKind>[] = [
    { value: 'PREMIUM_DEFAULT', label: 'Premium default' },
    { value: 'COURSE_PROMO', label: 'Course promo' },
    { value: 'LESSON_PROMO', label: 'Lesson promo' },
    { value: 'STREAK_TIER', label: 'Streak tier' },
    { value: 'CAMPAIGN', label: 'Campaign' },
  ];
  protected readonly targets: SelectOption<string>[] = [
    { value: 'BOTH', label: 'XP + Coins' },
    { value: 'XP', label: 'XP only' },
    { value: 'COINS', label: 'Coins only' },
  ];

  constructor() {
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const [q, b, m] = await Promise.all([
        this.client.listQuestTemplates(true),
        this.client.listBadges(true),
        this.client.listMultipliers(),
      ]);
      this.quests.set(q);
      this.badges.set(b);
      this.multipliers.set(m);
    } catch (err) {
      this.toast.error(this.describe(err, 'Failed to load gamification config'));
    }
  }

  protected async addQuest(): Promise<void> {
    this.savingQuest.set(true);
    try {
      const created = await this.client.createQuestTemplate({
        slug: this.qf.slug.trim(),
        kind: this.qf.kind,
        title: this.qf.title.trim(),
        difficulty: Number(this.qf.difficulty),
        target: Number(this.qf.target),
        xpReward: Number(this.qf.xpReward),
        coinReward: Number(this.qf.coinReward),
      });
      this.quests.update((rs) => [created, ...rs]);
      this.toast.success(`Quest "${created.title}" added`);
    } catch (err) {
      this.toast.error(this.describe(err, 'Add quest failed'));
    } finally {
      this.savingQuest.set(false);
    }
  }

  protected async removeQuest(q: QuestTemplate): Promise<void> {
    if (!(await this.confirm.open({ title: `Delete "${q.title}"?`, message: 'Removes this quest template from the daily pool.', confirmLabel: 'Delete', confirmKind: 'danger' }))) return;
    try {
      await this.client.deleteQuestTemplate(q.id);
      this.quests.update((rs) => rs.filter((x) => x.id !== q.id));
    } catch (err) {
      this.toast.error(this.describe(err, 'Delete failed'));
    }
  }

  protected async addBadge(): Promise<void> {
    this.ruleError.set(null);
    let rule: Record<string, unknown>;
    try {
      rule = JSON.parse(this.bf.rule);
    } catch {
      this.ruleError.set('Rule must be valid JSON');
      return;
    }
    this.savingBadge.set(true);
    try {
      const created = await this.client.createBadge({
        slug: this.bf.slug.trim(),
        name: this.bf.name.trim(),
        iconName: this.bf.iconName.trim() || undefined,
        rule,
        xpReward: Number(this.bf.xpReward),
        coinReward: Number(this.bf.coinReward),
        isHidden: this.bf.isHidden,
      });
      this.badges.update((rs) => [created, ...rs]);
      this.toast.success(`Badge "${created.name}" added`);
    } catch (err) {
      this.toast.error(this.describe(err, 'Add badge failed'));
    } finally {
      this.savingBadge.set(false);
    }
  }

  protected async removeBadge(b: BadgeDef): Promise<void> {
    if (!(await this.confirm.open({ title: `Delete "${b.name}"?`, message: 'This badge will be deactivated.', confirmLabel: 'Delete', confirmKind: 'danger' }))) return;
    try {
      await this.client.deleteBadge(b.id);
      this.badges.update((rs) => rs.filter((x) => x.id !== b.id));
    } catch (err) {
      this.toast.error(this.describe(err, 'Delete failed'));
    }
  }

  protected async addMultiplier(): Promise<void> {
    this.savingMult.set(true);
    try {
      const created = await this.client.createMultiplier({
        kind: this.mf.kind,
        target: this.mf.target as 'XP' | 'COINS' | 'BOTH',
        value: Number(this.mf.value),
        streakDaysMin: this.mf.streakDaysMin ? Number(this.mf.streakDaysMin) : null,
        description: this.mf.description.trim() || null,
      });
      this.multipliers.update((rs) => [created, ...rs]);
      this.toast.success(`Multiplier ${created.kind} ×${created.value} added`);
    } catch (err) {
      this.toast.error(this.describe(err, 'Add multiplier failed'));
    } finally {
      this.savingMult.set(false);
    }
  }

  protected async removeMultiplier(m: Multiplier): Promise<void> {
    if (!(await this.confirm.open({ title: `Delete ${m.kind} ×${m.value}?`, message: 'This multiplier will be permanently removed.', confirmLabel: 'Delete', confirmKind: 'danger' }))) return;
    try {
      await this.client.deleteMultiplier(m.id);
      this.multipliers.update((rs) => rs.filter((x) => x.id !== m.id));
    } catch (err) {
      this.toast.error(this.describe(err, 'Delete failed'));
    }
  }

  private describe(err: unknown, fallback: string): string {
    if (err instanceof ProblemDetailsError) {
      if (err.isForbidden) return 'Admins only.';
      if (err.status === 409) return 'That slug is already in use.';
      if (err.message) return err.message;
    }
    return fallback;
  }
}
