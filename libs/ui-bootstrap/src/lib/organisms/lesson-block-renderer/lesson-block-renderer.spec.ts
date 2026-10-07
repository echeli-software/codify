import { Component, input, signal, type Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  gradeQuiz,
  kitchenSinkLessonDoc,
  stripQuizAnswers,
  LESSON_DOC_VERSION,
  type LessonDoc,
  type LessonRefActivation,
  type QuizAnswers,
} from '@codify/lesson-schema';
import { LessonBlockRenderer } from './lesson-block-renderer.js';
import {
  LESSON_BLOCK_RENDERER,
  LessonRefSlot,
  type LessonQuizResult,
} from './lesson-render-context.js';

@Component({
  selector: 'cdf-test-host',
  imports: [LessonBlockRenderer, LessonRefSlot],
  template: `
    <cdf-lesson-block-renderer
      [doc]="doc()"
      [(quizAnswers)]="answers"
      [quizResult]="result()"
      (refActivate)="activated.push($event)"
    >
      @if (useSlot()) {
        <ng-template cdfLessonRef let-ref let-activate="activate">
          <button class="runner" type="button" (click)="activate()">
            Runner {{ ref.kind }} {{ ref.id }}
          </button>
        </ng-template>
      }
    </cdf-lesson-block-renderer>
  `,
})
class TestHost {
  readonly doc = signal<LessonDoc | null>(
    stripQuizAnswers(kitchenSinkLessonDoc()),
  );
  readonly result = signal<LessonQuizResult | null>(null);
  readonly useSlot = signal(false);
  answers: QuizAnswers = {};
  activated: LessonRefActivation[] = [];
}

async function mount(providers: unknown[] = []): Promise<{
  fixture: ComponentFixture<TestHost>;
  host: TestHost;
  el: HTMLElement;
}> {
  await TestBed.configureTestingModule({
    imports: [TestHost],
    providers: providers as never[],
  }).compileComponents();
  const fixture = TestBed.createComponent(TestHost);
  fixture.detectChanges();
  await fixture.whenStable();
  return {
    fixture,
    host: fixture.componentInstance,
    el: fixture.nativeElement as HTMLElement,
  };
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('LessonBlockRenderer', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders every block type of the kitchen-sink doc', async () => {
    const { el } = await mount();
    expect(el.querySelector('h2#every-block-once')?.textContent).toBe(
      'Every block, once',
    );
    expect(el.querySelector('h3')?.textContent).toBe('Lists');
    expect(el.querySelector('p strong')?.textContent).toBe('bold');
    expect(el.querySelector('p mark')?.textContent).toBe('highlight');
    expect(el.querySelectorAll('p kbd')).toHaveLength(2);
    expect(el.querySelector('p br')).toBeTruthy();
    expect(el.querySelector('ul li ol li')?.textContent).toContain(
      'Nested numbered item',
    );
    expect(el.querySelector('ol[start="3"]')).toBeTruthy();
    expect(el.querySelector('blockquote')?.textContent).toContain(
      'Programs must be written',
    );
    const callout = el.querySelector('.cdf-callout[data-callout="tip"]');
    expect(callout?.getAttribute('role')).toBe('note');
    expect(callout?.querySelector('li')).toBeTruthy();
    expect(
      el.querySelector('pre code.language-typescript')?.textContent,
    ).toContain('function greet');
    expect(el.querySelector('hr')).toBeTruthy();
    expect(el.querySelectorAll('cdf-lesson-quiz')).toHaveLength(2);
    expect(el.querySelectorAll('cdf-lesson-ref')).toHaveLength(3);
  });

  it('renders links safely', async () => {
    const { el } = await mount();
    const external = el.querySelector<HTMLAnchorElement>(
      'a[href="https://angular.dev"]',
    );
    expect(external?.getAttribute('target')).toBe('_blank');
    expect(external?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(el.querySelector('a[href="#quiz"]')?.hasAttribute('target')).toBe(
      false,
    );
  });

  it('drops javascript: links and data: images even if they reach the renderer', async () => {
    const { fixture, host, el } = await mount();
    host.doc.set({
      type: 'doc',
      version: LESSON_DOC_VERSION,
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'click',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
        {
          type: 'image',
          attrs: { src: 'data:image/svg+xml,<svg/>', alt: 'x' },
        },
      ],
    });
    await settle(fixture);
    expect(el.querySelector('a')).toBeNull();
    expect(el.querySelector('p')?.textContent).toBe('click');
    expect(el.querySelector('figure img')).toBeNull();
  });

  describe('images', () => {
    it('renders lazy images with alt text and caption', async () => {
      const { el } = await mount();
      const img = el.querySelector<HTMLImageElement>('figure.cdf-figure img');
      expect(img?.getAttribute('alt')).toBe('Diagram of the component tree');
      expect(img?.getAttribute('loading')).toBe('lazy');
      expect(img?.getAttribute('src')).toBe(
        'https://cdn.codify.app/img/0192f3a4-sample',
      );
      expect(
        el.querySelector('figure.cdf-figure')?.getAttribute('data-width'),
      ).toBe('wide');
      expect(el.querySelector('figcaption')?.textContent).toContain(
        'component tree',
      );
    });
  });

  describe('embeds', () => {
    it('renders a sandboxed iframe with the canonical allowlisted src', async () => {
      const { el } = await mount();
      const iframe = el.querySelector<HTMLIFrameElement>('.cdf-embed iframe');
      expect(iframe?.getAttribute('src')).toBe(
        'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      );
      expect(iframe?.getAttribute('sandbox')).toContain('allow-scripts');
      expect(iframe?.getAttribute('sandbox')).not.toContain(
        'allow-top-navigation',
      );
      expect(iframe?.getAttribute('title')).toBe('Intro video');
      expect(iframe?.getAttribute('loading')).toBe('lazy');
    });

    it('never renders an iframe for a URL outside the provider allowlist', async () => {
      const { fixture, host, el } = await mount();
      host.doc.set({
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'embed',
            attrs: {
              provider: 'youtube',
              url: 'https://evil.example/watch?v=dQw4w9WgXcQ',
              title: 'x',
            },
          },
        ],
      });
      await settle(fixture);
      expect(el.querySelector('iframe')).toBeNull();
      expect(el.querySelector('.cdf-embed__unavailable')).toBeTruthy();
    });
  });

  describe('tables', () => {
    it('renders a header row with column scopes inside a focusable scroll region', async () => {
      const { el } = await mount();
      const region = el.querySelector('.cdf-table-wrap');
      expect(region?.getAttribute('role')).toBe('region');
      expect(region?.getAttribute('tabindex')).toBe('0');
      const ths = el.querySelectorAll('table thead th');
      expect(Array.from(ths).map((t) => t.getAttribute('scope'))).toEqual([
        'col',
        'col',
      ]);
      expect(el.querySelector('table tbody td code')?.textContent).toBe(
        'signal()',
      );
    });
  });

  describe('quizzes', () => {
    it('emits quizAnswersChange as the student selects options', async () => {
      const { fixture, host, el } = await mount();
      const quiz = el.querySelector<HTMLElement>('#quiz-quiz')!;
      expect(quiz.querySelector('legend')?.textContent).toContain(
        'writable signal',
      );
      const radios = quiz.querySelectorAll<HTMLInputElement>(
        'input[type="radio"]',
      );
      expect(radios).toHaveLength(3);
      radios[1].click();
      await settle(fixture);
      expect(host.answers).toEqual({ quiz: ['b'] });
      radios[0].click();
      await settle(fixture);
      expect(host.answers).toEqual({ quiz: ['a'] });

      const boxes = el.querySelectorAll<HTMLInputElement>(
        '#quiz-q2 input[type="checkbox"]',
      );
      boxes[0].click();
      boxes[1].click();
      await settle(fixture);
      expect(host.answers).toEqual({ quiz: ['a'], q2: ['a', 'b'] });
    });

    it('shows per-question feedback from quizResult and locks the inputs', async () => {
      const { fixture, host, el } = await mount();
      const graded = gradeQuiz(kitchenSinkLessonDoc(), {
        quiz: ['b'],
        q2: ['a', 'b'],
      });
      host.answers = { quiz: ['b'], q2: ['a', 'b'] };
      host.result.set(graded);
      await settle(fixture);

      const first = el.querySelector<HTMLElement>('#quiz-quiz')!;
      expect(first.classList).toContain('cdf-quiz--incorrect');
      expect(first.querySelector('[role="status"]')?.textContent).toContain(
        'Not quite.',
      );
      expect(first.querySelector('[role="status"]')?.textContent).toContain(
        'computed() is read-only',
      );
      expect(
        first.querySelector('.cdf-quiz__option--answer')?.textContent,
      ).toContain('signal()');
      expect(
        first.querySelector('.cdf-quiz__option--wrong')?.textContent,
      ).toContain('computed()');
      expect(
        Array.from(first.querySelectorAll('input')).every(
          (i) => (i as HTMLInputElement).disabled,
        ),
      ).toBe(true);

      const second = el.querySelector<HTMLElement>('#quiz-q2')!;
      expect(second.classList).toContain('cdf-quiz--correct');
      expect(second.querySelector('[role="status"]')?.textContent).toContain(
        'Correct!',
      );
    });

    it('does not reveal answers before grading (stripped doc)', async () => {
      const { el } = await mount();
      expect(el.querySelector('.cdf-quiz__option--answer')).toBeNull();
      expect(el.textContent).not.toContain('computed() is read-only');
    });
  });

  describe('ref blocks', () => {
    it('renders labeled cards that emit refActivate', async () => {
      const { fixture, host, el } = await mount();
      const cards = el.querySelectorAll<HTMLElement>('.cdf-ref-card');
      expect(
        Array.from(cards).map((c) => c.querySelector('h3')?.textContent),
      ).toEqual(['Code exercise', 'AI prompt', 'Scenario']);
      cards[0].querySelector('button')!.click();
      cards[2].querySelector('button')!.click();
      await settle(fixture);
      expect(host.activated).toEqual([
        { kind: 'exercise', id: '0192f3a4-0000-7000-8000-000000000001' },
        { kind: 'scenario', id: '0192f3a4-0000-7000-8000-000000000003' },
      ]);
    });

    it('mounts the projected cdfLessonRef template instead of the card', async () => {
      const { fixture, host, el } = await mount();
      host.useSlot.set(true);
      await settle(fixture);
      const runners = el.querySelectorAll<HTMLButtonElement>('button.runner');
      expect(runners).toHaveLength(3);
      expect(runners[1].textContent).toContain(
        'Runner aiPrompt 0192f3a4-0000-7000-8000-000000000002',
      );
      runners[1].click();
      expect(host.activated).toEqual([
        { kind: 'aiPrompt', id: '0192f3a4-0000-7000-8000-000000000002' },
      ]);
      expect(el.querySelector('.cdf-ref-card')).toBeNull();
    });
  });

  it('lets apps override blocks through LESSON_BLOCK_RENDERER', async () => {
    @Component({
      selector: 'cdf-test-divider',
      template: '<div class="custom-divider">custom</div>',
    })
    class CustomDivider {
      readonly node = input<unknown>();
    }
    const { el } = await mount([
      {
        provide: LESSON_BLOCK_RENDERER,
        useValue: {
          resolve: (t: string): Type<unknown> | null =>
            t === 'horizontalRule' ? CustomDivider : null,
        },
      },
    ]);
    expect(el.querySelector('.custom-divider')).toBeTruthy();
    expect(el.querySelector('hr')).toBeNull();
  });
});
