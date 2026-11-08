import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  afterNextRender,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@codify/i18n';
import {
  buildBrowserSrcdoc,
  type BrowserResultMessage,
  type BrowserRunMessage,
} from '@codify/domain';
import { newClientEventId } from '../offline/event-queue.js';

/** How long a run may take before every test is reported as timed out. */
export const WEB_RUN_TIMEOUT_MS = 5000;

/**
 * Live preview + test harness for browser-side exercises (docs/12 §4).
 *
 * The student's HTML/CSS/JS runs in `<iframe sandbox="allow-scripts">`
 * (no `allow-same-origin`: an opaque origin with no access to the app's
 * cookies, storage or DOM) under a CSP that blocks all network requests.
 * `srcdoc` is assigned from code — Angular's template binding would
 * sanitize the scripts away. The parent only accepts a result message
 * from that frame's window carrying the run's nonce.
 */
@Component({
  selector: 'cdf-lesson-web-frame',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <p class="wf__label" id="wf-label">
      {{ 'student.exercise.preview' | translate }}
    </p>
    <iframe
      #frame
      class="wf__frame"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      aria-labelledby="wf-label"
      data-testid="web-exercise-frame"
      [attr.title]="'student.exercise.preview' | translate"
    ></iframe>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .wf__label {
        margin: 0 0 4px;
        font-size: var(--cdf-font-size-sm);
        font-weight: 600;
      }
      .wf__frame {
        width: 100%;
        height: 220px;
        border: 1px solid var(--cdf-color-border);
        border-radius: var(--cdf-radius-md, 10px);
        background: #fff;
      }
    `,
  ],
})
export class LessonWebFrame {
  /** Code rendered on first paint (the starter code). */
  readonly initialCode = input('');

  private readonly frame =
    viewChild.required<ElementRef<HTMLIFrameElement>>('frame');
  private cleanup: (() => void) | null = null;

  constructor() {
    afterNextRender(() => void this.render(this.initialCode()));
    inject(DestroyRef).onDestroy(() => this.cleanup?.());
  }

  /** Load `code` into a fresh document; resolves once it has loaded. */
  render(code: string): Promise<void> {
    const el = this.frame().nativeElement;
    return new Promise<void>((resolve) => {
      const done = () => {
        el.removeEventListener('load', done);
        resolve();
      };
      el.addEventListener('load', done);
      el.srcdoc = buildBrowserSrcdoc(code);
      // A frame that never fires load (blocked) must not hang the caller.
      setTimeout(done, WEB_RUN_TIMEOUT_MS);
    });
  }

  /**
   * Render `code`, then ask the harness to probe `tests`. Null when the
   * page didn't answer in time (infinite loop, crash before the harness).
   */
  async run(
    code: string,
    tests: { id: string; args: unknown[] }[],
  ): Promise<BrowserResultMessage | null> {
    this.cleanup?.();
    await this.render(code);
    const el = this.frame().nativeElement;
    const nonce = newClientEventId();
    return new Promise((resolve) => {
      const onMessage = (ev: MessageEvent) => {
        if (ev.source !== el.contentWindow) return;
        const data = ev.data as BrowserResultMessage | null;
        if (data?.type !== 'codify:test-results' || data.nonce !== nonce)
          return;
        finish(data);
      };
      const timer = setTimeout(() => finish(null), WEB_RUN_TIMEOUT_MS);
      const finish = (v: BrowserResultMessage | null) => {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        this.cleanup = null;
        resolve(v);
      };
      this.cleanup = () => finish(null);
      window.addEventListener('message', onMessage);
      const msg: BrowserRunMessage = { type: 'codify:run-tests', nonce, tests };
      // Opaque-origin frame: '*' is the only target origin that matches.
      el.contentWindow?.postMessage(msg, '*');
    });
  }
}
