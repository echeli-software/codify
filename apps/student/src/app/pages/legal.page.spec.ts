import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { AuthService } from '@codify/auth';
import { provideI18n } from '@codify/i18n';
import { staticTranslationBundles } from '@codify/i18n/testing';
import { PublicLayoutComponent } from '../components/public-layout.component.js';
import { LEGAL_SECTION_COUNT, LegalPage, type LegalDoc } from './legal.page.js';

/** Stand-in for the public chrome; the page body is what's under test. */
@Component({
  selector: 'cdf-public-layout',
  template: '<ng-content />',
})
class PublicLayoutStub {}

type Tree = Record<string, unknown>;

function legalStrings(locale: 'pt-BR' | 'en-US'): Tree {
  const bundle = staticTranslationBundles()[locale] as Tree;
  return (bundle['student'] as Tree)['legal'] as Tree;
}

describe('legal strings', () => {
  it.each(['pt-BR', 'en-US'] as const)(
    '%s has a title + body for exactly the declared sections',
    (locale) => {
      const legal = legalStrings(locale);
      for (const doc of ['privacy', 'terms'] as LegalDoc[]) {
        const d = legal[doc] as Tree;
        expect(typeof d['title']).toBe('string');
        expect(typeof d['intro']).toBe('string');
        expect(typeof d['metaDescription']).toBe('string');
        const sections = d['sections'] as { title: string; body: string }[];
        expect(sections).toHaveLength(LEGAL_SECTION_COUNT[doc]);
        for (const s of sections) {
          expect(s.title.trim()).not.toBe('');
          expect(s.body.trim()).not.toBe('');
        }
      }
      expect(typeof legal['draftNotice']).toBe('string');
    },
  );
});

describe('LegalPage', () => {
  async function render(doc: LegalDoc) {
    await TestBed.configureTestingModule({
      imports: [LegalPage],
      providers: [
        provideRouter([]),
        provideIonicAngular(),
        provideI18n(),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { doc } } } },
        { provide: AuthService, useValue: { isAuthenticated: signal(false) } },
      ],
    })
      .overrideComponent(LegalPage, {
        remove: { imports: [PublicLayoutComponent] },
        add: { imports: [PublicLayoutStub] },
      })
      .compileComponents();
    const fixture = TestBed.createComponent(LegalPage);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it.each([
    ['privacy', 'Privacy Policy'],
    ['terms', 'Terms of Use'],
  ] as const)(
    'renders /%s with the draft notice, contents and every section',
    async (doc, title) => {
      const el = await render(doc);
      expect(el.querySelector('h1')?.textContent).toContain(title);
      expect(
        el.querySelector('[data-testid="legal-draft-notice"]')?.textContent,
      ).toContain('Draft pending legal review');
      const sections = el.querySelectorAll('section.lg__section');
      expect(sections).toHaveLength(LEGAL_SECTION_COUNT[doc]);
      expect(el.querySelectorAll('.lg__toc li')).toHaveLength(
        LEGAL_SECTION_COUNT[doc],
      );
      // Anchors in the table of contents point at real section ids.
      const first = el.querySelector('.lg__toc a')?.getAttribute('href');
      expect(first).toBe(`#${doc}-0`);
      expect(el.querySelector(`#${doc}-0`)).not.toBeNull();
      // No raw translation keys leaked into the page.
      expect(el.textContent).not.toContain('student.legal.');
    },
  );
});
