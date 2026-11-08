import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContentTranslatePipe, TranslatePipe } from '@codify/i18n';
import { Icon } from '@codify/ui-ionic';
import type { OutlineModule } from '../pages/lesson/lesson-nav.js';

/**
 * Module outline of the lesson player (docs/05 Lesson player): a side rail
 * at ≥ lg, a sheet behind the outline button below. Marks completed,
 * pending-sync (clock) and downloaded lessons; the current one is
 * `aria-current="page"`.
 */
@Component({
  selector: 'cdf-lesson-outline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, TranslatePipe, ContentTranslatePipe],
  template: `
    <nav
      class="lo"
      [attr.aria-label]="'student.lesson.outline' | translate"
      data-testid="lesson-outline"
    >
      @for (m of modules(); track m.id; let mi = $index) {
        <section class="lo__module">
          <h3 class="lo__title">
            {{
              'student.course.module'
                | translate
                  : {
                      n: mi + 1,
                      title: (m.id | tContent: 'MODULE' : 'title' : m.title),
                    }
            }}
          </h3>
          <ol class="lo__lessons">
            @for (l of m.lessons; track l.id) {
              <li>
                <a
                  class="lo__lesson"
                  [class.lo__lesson--current]="l.current"
                  [attr.aria-current]="l.current ? 'page' : null"
                  [routerLink]="['/lessons', l.id]"
                  [attr.data-outline-lesson]="l.id"
                  (click)="navigated.emit(l.id)"
                >
                  <cdf-icon
                    [name]="l.completed ? 'check-circle' : 'play'"
                    size="xs"
                    [label]="
                      (l.completed
                        ? 'student.lesson.outlineDone'
                        : 'student.lesson.outlineTodo'
                      ) | translate
                    "
                  />
                  <span class="lo__name">{{
                    l.id | tContent: 'LESSON' : 'title' : l.title
                  }}</span>
                  @if (l.pending) {
                    <cdf-icon
                      name="hourglass"
                      size="xs"
                      [label]="'student.course.pendingSync' | translate"
                    />
                  }
                  @if (l.downloaded) {
                    <cdf-icon
                      name="download"
                      size="xs"
                      [label]="
                        'student.course.download.lessonSaved' | translate
                      "
                    />
                  }
                </a>
              </li>
            }
          </ol>
        </section>
      }
    </nav>
  `,
  styles: [
    `
      .lo {
        display: flex;
        flex-direction: column;
        gap: var(--cdf-space-3, 12px);
      }
      .lo__title {
        margin: 0 0 4px;
        font-size: var(--cdf-font-size-xs, 12px);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--cdf-color-text-muted);
      }
      .lo__lessons {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .lo__lesson {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        min-height: 40px;
        border-radius: 8px;
        color: inherit;
        text-decoration: none;
        font-size: var(--cdf-font-size-sm, 14px);
      }
      .lo__lesson:hover {
        background: var(--cdf-color-primary-subtle, #eef2ff);
      }
      .lo__lesson--current {
        background: var(--cdf-color-primary-subtle, #eef2ff);
        font-weight: 600;
      }
      .lo__lesson:focus-visible {
        outline: 2px solid var(--cdf-color-primary);
        outline-offset: 2px;
      }
      .lo__name {
        flex: 1;
        min-width: 0;
      }
    `,
  ],
})
export class LessonOutline {
  readonly modules = input.required<OutlineModule[]>();
  /** A lesson link was followed (the sheet closes itself). */
  readonly navigated = output<string>();
}
