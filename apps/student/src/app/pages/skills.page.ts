import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonContent,
} from '@ionic/angular/standalone';
import {
  AppButton,
  AppCard,
  AppSkeleton,
  EmptyState,
  ErrorState,
  Icon,
  type IconName,
} from '@codify/ui-ionic';
import {
  MasteryClient,
  type MasteryLevel,
  type MasteryView,
  type SkillNode,
  type SkillNodeState,
} from '@codify/api-client';
import { TranslatePipe } from '@codify/i18n';
import { OfflineGate } from '../platform/offline-gate.component.js';
import { errorMessageKey } from '../platform/app-toast.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';

const MEDAL: Record<MasteryLevel, string> = {
  NONE: '○',
  BRONZE: '🥉',
  SILVER: '🥈',
  GOLD: '🥇',
};

const NODE_ICON: Record<SkillNodeState, IconName> = {
  COMPLETED: 'check-circle',
  IN_PROGRESS: 'play',
  AVAILABLE: 'arrow-forward',
  LOCKED: 'lock',
};

/**
 * Skill tree (docs/10 §7): per-topic Bronze / Silver / Gold mastery from
 * completed lessons, quiz / exercise results and spaced-repetition reviews
 * (the "Review" card opens the due queue at /skills/review), and per course an
 * ordered path of modules that light up as they are completed; locked
 * nodes name the module that unlocks them. A real list structure (topic →
 * course → module) so screen readers get the hierarchy and state.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    AppButton,
    AppCard,
    AppSkeleton,
    EmptyState,
    ErrorState,
    Icon,
    OfflineGate,
    TranslatePipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/profile" />
        </ion-buttons>
        <ion-title>{{ 'student.skills.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="sk">
        <cdf-offline-gate capability="social">
          <p class="sk__intro">{{ 'student.skills.intro' | translate }}</p>
          @if (loading()) {
            <cdf-app-skeleton shape="rect" [height]="240" />
          } @else if (errorKey(); as e) {
            <cdf-error-state [description]="e | translate" (retry)="load()" />
          } @else if (view(); as v) {
            @if (v.topics.length === 0) {
              <cdf-empty-state
                icon="school"
                [title]="'student.skills.emptyTitle' | translate"
                [description]="'student.skills.emptyBody' | translate"
              />
            } @else {
              <cdf-app-card padding="normal">
                <section
                  class="sk__review"
                  aria-labelledby="sk-review"
                  data-testid="review-entry"
                  [attr.data-due]="v.reviewsDue ?? 0"
                >
                  <div class="sk__review-copy">
                    <h2 id="sk-review">
                      {{ 'student.skills.review.title' | translate }}
                    </h2>
                    <p class="sk__muted">
                      {{
                        'student.skills.review.due'
                          | translate: { count: v.reviewsDue ?? 0 }
                      }}
                    </p>
                    <p class="sk__muted">
                      {{ 'student.skills.review.hint' | translate }}
                    </p>
                  </div>
                  @if (v.reviewsDue) {
                    <cdf-app-button
                      kind="primary"
                      size="sm"
                      routerLink="/skills/review"
                      data-testid="review-start"
                    >
                      {{ 'student.skills.review.start' | translate }}
                    </cdf-app-button>
                  }
                </section>
              </cdf-app-card>

              <ul
                class="sk__totals"
                [attr.aria-label]="'student.skills.totals' | translate"
                data-testid="mastery-totals"
              >
                @for (lvl of levels; track lvl) {
                  <li [attr.data-level]="lvl">
                    <span aria-hidden="true">{{ medal(lvl) }}</span>
                    {{
                      'student.skills.levelCount'
                        | translate
                          : {
                              level:
                                ('student.skills.level.' + lvl | translate),
                              count: v.totals[lvl],
                            }
                    }}
                  </li>
                }
              </ul>

              <ul class="sk__topics" data-testid="skill-tree">
                @for (t of v.topics; track t.categoryId ?? 'other') {
                  <li>
                    <cdf-app-card padding="normal">
                      <section
                        class="sk__topic"
                        [attr.aria-labelledby]="'sk-t-' + (t.slug ?? 'other')"
                        [attr.data-mastery]="t.mastery"
                      >
                        <header class="sk__topic-head">
                          <span class="sk__medal" aria-hidden="true">{{
                            medal(t.mastery)
                          }}</span>
                          <div class="sk__topic-copy">
                            <h2 [id]="'sk-t-' + (t.slug ?? 'other')">
                              {{
                                t.name ?? ('student.skills.other' | translate)
                              }}
                            </h2>
                            <p class="sk__muted">
                              {{
                                'student.skills.topicLine'
                                  | translate
                                    : {
                                        level:
                                          ('student.skills.level.' + t.mastery
                                          | translate),
                                        done: t.lessonsCompleted,
                                        total: t.lessonsTotal,
                                      }
                              }}
                              @if (t.scorePct !== null) {
                                ·
                                {{
                                  'student.skills.score'
                                    | translate: { pct: t.scorePct }
                                }}
                              }
                              @if (t.reviews?.cards) {
                                ·
                                {{
                                  'student.skills.reviewsLine'
                                    | translate
                                      : {
                                          mastered: t.reviews!.mastered,
                                          cards: t.reviews!.cards,
                                        }
                                }}
                              }
                            </p>
                          </div>
                        </header>
                        <div
                          class="sk__bar"
                          role="progressbar"
                          [attr.aria-valuenow]="
                            pct(t.lessonsCompleted, t.lessonsTotal)
                          "
                          aria-valuemin="0"
                          aria-valuemax="100"
                          [attr.aria-label]="
                            'student.skills.progressLabel'
                              | translate: { name: t.name ?? '' }
                          "
                        >
                          <span
                            [style.width.%]="
                              pct(t.lessonsCompleted, t.lessonsTotal)
                            "
                          ></span>
                        </div>

                        <ul class="sk__courses">
                          @for (c of t.courses; track c.courseId) {
                            <li class="sk__course">
                              <h3>
                                <a [routerLink]="['/courses', c.slug]">{{
                                  c.title ?? c.slug
                                }}</a>
                                <span class="sk__course-medal">
                                  <span aria-hidden="true">{{
                                    medal(c.mastery)
                                  }}</span>
                                  {{
                                    'student.skills.level.' + c.mastery
                                      | translate
                                  }}
                                </span>
                              </h3>
                              <ol
                                class="sk__path"
                                [attr.aria-label]="
                                  'student.skills.pathLabel'
                                    | translate: { name: c.title ?? c.slug }
                                "
                              >
                                @for (n of c.nodes; track n.moduleId) {
                                  <li
                                    class="sk__node"
                                    [attr.data-state]="n.state"
                                  >
                                    <cdf-icon
                                      [name]="nodeIcon(n.state)"
                                      size="sm"
                                    />
                                    <span class="sk__node-copy">
                                      <strong>{{
                                        n.title ??
                                          ('student.skills.module'
                                            | translate: { n: n.order })
                                      }}</strong>
                                      <span class="sk__muted">
                                        {{
                                          'student.skills.state.' + n.state
                                            | translate
                                              : {
                                                  done: n.lessonsCompleted,
                                                  total: n.lessonsTotal,
                                                  prereq: prereqTitle(
                                                    c.nodes,
                                                    n
                                                  ),
                                                }
                                        }}
                                      </span>
                                    </span>
                                  </li>
                                }
                              </ol>
                            </li>
                          }
                        </ul>
                      </section>
                    </cdf-app-card>
                  </li>
                }
              </ul>
              <p class="sk__muted sk__legend">
                {{ 'student.skills.legend' | translate }}
              </p>
            }
          }
        </cdf-offline-gate>
      </div>
    </ion-content>
  `,
  styles: [
    `
      .sk {
        max-width: 960px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-3);
      }
      .sk__intro,
      .sk__muted {
        color: var(--cdf-color-text-muted);
        font-size: var(--cdf-font-size-sm);
        margin: 0;
      }
      .sk__review {
        display: flex;
        gap: var(--cdf-space-3);
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
      }
      .sk__review h2 {
        margin: 0 0 4px;
        font-size: var(--cdf-font-size-md);
      }
      .sk__review-copy {
        flex: 1 1 240px;
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      .sk__totals {
        list-style: none;
        margin: 0 0 var(--cdf-space-2);
        padding: 0;
        display: flex;
        gap: var(--cdf-space-2);
        flex-wrap: wrap;
      }
      .sk__totals li {
        padding: 4px 12px;
        border-radius: 999px;
        border: 1px solid var(--cdf-color-border);
        font-size: var(--cdf-font-size-sm);
      }
      .sk__topics,
      .sk__courses {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--cdf-space-3);
      }
      @media (min-width: 1024px) {
        .sk__topics {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      .sk__topic-head {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: center;
      }
      .sk__medal {
        font-size: 32px;
        line-height: 1;
      }
      .sk__topic h2 {
        margin: 0;
        font-size: var(--cdf-font-size-md);
      }
      .sk__bar {
        height: 8px;
        border-radius: 4px;
        background: var(--cdf-color-surface-2, rgba(0, 0, 0, 0.08));
        overflow: hidden;
        margin: var(--cdf-space-2) 0 var(--cdf-space-3);
      }
      .sk__bar span {
        display: block;
        height: 100%;
        background: var(--cdf-color-primary);
      }
      .sk__course h3 {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: var(--cdf-space-2);
        flex-wrap: wrap;
        margin: 0 0 var(--cdf-space-2);
        font-size: var(--cdf-font-size-sm);
      }
      .sk__course h3 a {
        color: var(--cdf-color-primary);
      }
      .sk__course-medal {
        font-weight: 500;
        color: var(--cdf-color-text-muted);
      }
      .sk__path {
        list-style: none;
        margin: 0;
        padding: 0 0 0 14px;
        border-left: 3px solid var(--cdf-color-border);
        display: grid;
        gap: 6px;
      }
      .sk__node {
        display: flex;
        gap: var(--cdf-space-2);
        align-items: center;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid var(--cdf-color-border);
        background: var(--cdf-color-surface);
      }
      .sk__node[data-state='COMPLETED'] {
        border-color: var(--cdf-color-success, var(--cdf-color-primary));
        background: var(--cdf-color-primary-subtle, transparent);
      }
      .sk__node[data-state='IN_PROGRESS'] {
        border-color: var(--cdf-color-primary);
      }
      .sk__node[data-state='LOCKED'] {
        opacity: 0.75;
        border-style: dashed;
      }
      .sk__node-copy {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .sk__legend {
        margin-top: var(--cdf-space-2);
      }
    `,
  ],
})
export class SkillsPage {
  private readonly client = inject(MasteryClient);
  private readonly telemetry = inject(TelemetryService);

  protected readonly levels: MasteryLevel[] = ['GOLD', 'SILVER', 'BRONZE'];
  protected readonly loading = signal(true);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly view = signal<MasteryView | null>(null);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const v = await this.client.mastery();
      this.view.set(v);
      this.telemetry.track('skill_tree_viewed', {
        topics: v.topics.length,
        gold: v.totals.GOLD,
        reviewsDue: v.reviewsDue ?? 0,
      });
    } catch (err) {
      this.errorKey.set(errorMessageKey(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected medal(level: MasteryLevel): string {
    return MEDAL[level];
  }

  protected nodeIcon(state: SkillNodeState): IconName {
    return NODE_ICON[state];
  }

  protected pct(done: number, total: number): number {
    return total > 0 ? Math.round((done / total) * 100) : 0;
  }

  protected prereqTitle(nodes: SkillNode[], node: SkillNode): string {
    const pre = nodes.find((n) => n.moduleId === node.prerequisiteModuleId);
    return pre?.title ?? String(pre?.order ?? '');
  }
}
