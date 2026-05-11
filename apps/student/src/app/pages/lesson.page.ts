import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonContent,
} from '@ionic/angular/standalone';
import { EmptyState } from '@codify/ui-ionic';

/**
 * Phase 5e placeholder for the student lesson player. Phase 5f will
 * replace this with the LessonBlockRenderer + Progress recording. For
 * now it just confirms the route resolves and shows the resolved id so
 * the curriculum click-through can be verified end-to-end.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    EmptyState,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/catalog" />
        </ion-buttons>
        <ion-title>Lesson</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <cdf-empty-state
        icon="school"
        title="Lesson player landing soon"
        description="Phase 5f will render the lesson content + reading/quiz blocks here."
      />
      <p data-testid="lesson-id" class="lesson-id-debug">{{ id() }}</p>
    </ion-content>
  `,
  styles: [
    `
      .lesson-id-debug {
        text-align: center;
        font-family: var(--cdf-font-family-mono, monospace);
        font-size: var(--cdf-font-size-xs);
        color: var(--cdf-color-text-muted);
      }
    `,
  ],
})
export class LessonPage {
  private readonly route = inject(ActivatedRoute);
  protected readonly id = signal('');

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((pm) => {
      this.id.set(pm.get('id') ?? '');
    });
  }
}
