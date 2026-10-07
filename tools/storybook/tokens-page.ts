/**
 * "Foundations/Tokens" Storybook page shared by both UI libraries.
 *
 * Renders straight from the design tokens as shipped: it scans the loaded
 * stylesheets for `--cdf-*` custom properties declared on `:root` (emitted
 * by libs/ui-tokens `theme-light` / `theme-dark`), resolves each one in the
 * light AND dark theme, and lays them out by group (color, spacing, type,
 * radius, shadow, motion, z-index, breakpoints). Text-on-surface pairs show
 * their WCAG contrast ratio (docs/03 ui-tokens "Done when").
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
  type OnInit,
} from '@angular/core';
import { contrastRatio } from '@codify/ui-core';

type Theme = 'light' | 'dark';

export type TokenGroup =
  | 'color'
  | 'space'
  | 'font-size'
  | 'font-weight'
  | 'line-height'
  | 'font-family'
  | 'radius'
  | 'shadow'
  | 'motion'
  | 'z'
  | 'breakpoint';

interface Token {
  name: string;
  light: string;
  dark: string;
}

const GROUP_PREFIX: [TokenGroup, string][] = [
  ['color', '--cdf-color-'],
  ['space', '--cdf-space-'],
  ['font-size', '--cdf-font-size-'],
  ['font-weight', '--cdf-font-weight-'],
  ['line-height', '--cdf-line-height-'],
  ['font-family', '--cdf-font-family-'],
  ['radius', '--cdf-radius-'],
  ['shadow', '--cdf-shadow-'],
  ['motion', '--cdf-motion-'],
  ['z', '--cdf-z-'],
  ['breakpoint', '--cdf-breakpoint-'],
];

const TEXT_TOKENS = [
  '--cdf-color-text',
  '--cdf-color-text-muted',
  '--cdf-color-text-subtle',
  '--cdf-color-primary-text',
  '--cdf-color-success-text',
  '--cdf-color-warning-text',
  '--cdf-color-danger-text',
  '--cdf-color-info-text',
  '--cdf-color-coin-text',
  '--cdf-color-xp-text',
  '--cdf-color-premium-text',
  '--cdf-color-flame-text',
];
const SURFACE_TOKENS = [
  '--cdf-color-bg',
  '--cdf-color-surface',
  '--cdf-color-surface-elev',
];

/** Every `--cdf-*` property declared on a `:root` rule of a loaded stylesheet. */
export function declaredTokenNames(doc: Document = document): string[] {
  const names = new Set<string>();
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && rule.selectorText.includes(':root')) {
        for (const prop of Array.from(rule.style))
          if (prop.startsWith('--cdf-')) names.add(prop);
      } else if ('cssRules' in rule) {
        visit((rule as CSSGroupingRule).cssRules);
      }
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      visit(sheet.cssRules);
    } catch {
      /* cross-origin sheet (fonts) — skip */
    }
  }
  return [...names];
}

function readTheme(names: string[], theme: Theme): Record<string, string> {
  const root = document.documentElement;
  const had = {
    light: root.classList.contains('theme-light'),
    dark: root.classList.contains('theme-dark'),
  };
  root.classList.remove('theme-light', 'theme-dark');
  root.classList.add(`theme-${theme}`);
  const cs = getComputedStyle(root);
  const out: Record<string, string> = {};
  for (const n of names) out[n] = cs.getPropertyValue(n).trim();
  root.classList.remove('theme-light', 'theme-dark');
  if (had.light) root.classList.add('theme-light');
  if (had.dark) root.classList.add('theme-dark');
  return out;
}

function isHex(v: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);
}

@Component({
  selector: 'sb-tokens-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="tk">
      <h1>Design tokens</h1>
      <p class="tk__lead">
        Read live from <code>--cdf-*</code> CSS custom properties emitted by
        <code>libs/ui-tokens</code> ({{ total() }} tokens). Components must only
        consume these variables — never raw colours.
      </p>

      @if (show('color')) {
        <section>
          <h2>Color</h2>
          <table class="tk__table">
            <caption>
              Light and dark values per colour token
            </caption>
            <thead>
              <tr>
                <th scope="col">Token</th>
                <th scope="col">Light</th>
                <th scope="col">Dark</th>
              </tr>
            </thead>
            <tbody>
              @for (t of group('color'); track t.name) {
                <tr>
                  <th scope="row">
                    <code>{{ t.name }}</code>
                  </th>
                  <td>
                    <span class="tk__swatch" [style.background]="t.light"></span
                    ><code>{{ t.light }}</code>
                  </td>
                  <td>
                    <span class="tk__swatch" [style.background]="t.dark"></span
                    ><code>{{ t.dark }}</code>
                  </td>
                </tr>
              }
            </tbody>
          </table>

          <h3>Text on surface contrast (WCAG AA ≥ 4.5:1)</h3>
          <table class="tk__table">
            <caption>
              Contrast ratio of each text token on each surface token
            </caption>
            <thead>
              <tr>
                <th scope="col">Text token</th>
                @for (s of surfaces; track s) {
                  <th scope="col">{{ s.replace('--cdf-color-', '') }} light</th>
                  <th scope="col">{{ s.replace('--cdf-color-', '') }} dark</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of contrast(); track row.text) {
                <tr>
                  <th scope="row">
                    <code>{{ row.text }}</code>
                  </th>
                  @for (c of row.cells; track $index) {
                    <td [class.tk__fail]="c < 4.5">
                      {{ c.toFixed(2) }}{{ c < 4.5 ? ' ✗' : ' ✓' }}
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </section>
      }

      @if (show('space')) {
        <section>
          <h2>Spacing</h2>
          <ul class="tk__list">
            @for (t of group('space'); track t.name) {
              <li>
                <code>{{ t.name }}</code>
                <span class="tk__bar" [style.width]="t.light"></span>
                <code>{{ t.light }}</code>
              </li>
            }
          </ul>
        </section>
      }

      @if (show('font-size')) {
        <section>
          <h2>Typography</h2>
          @for (t of group('font-family'); track t.name) {
            <p [style.font-family]="t.light">
              <code>{{ t.name }}</code> — The quick brown fox
            </p>
          }
          @for (t of group('font-size'); track t.name) {
            <p [style.font-size]="t.light" class="tk__type">
              <code>{{ t.name }} {{ t.light }}</code> Aprender é um jogo
            </p>
          }
          @for (t of group('font-weight'); track t.name) {
            <p [style.font-weight]="t.light">
              <code>{{ t.name }} {{ t.light }}</code> Weight sample
            </p>
          }
          @for (t of group('line-height'); track t.name) {
            <p>
              <code>{{ t.name }}</code> {{ t.light }}
            </p>
          }
        </section>
      }

      @if (show('radius')) {
        <section>
          <h2>Radius</h2>
          <ul class="tk__grid">
            @for (t of group('radius'); track t.name) {
              <li>
                <span class="tk__box" [style.border-radius]="t.light"></span
                ><code>{{ t.name }}</code
                ><code>{{ t.light }}</code>
              </li>
            }
          </ul>
        </section>
      }

      @if (show('shadow')) {
        <section>
          <h2>Shadow / elevation</h2>
          <ul class="tk__grid">
            @for (t of group('shadow'); track t.name) {
              <li>
                <span
                  class="tk__box tk__box--shadow"
                  [style.box-shadow]="t.light"
                ></span
                ><code>{{ t.name }}</code>
              </li>
            }
          </ul>
        </section>
      }

      @if (show('motion')) {
        <section>
          <h2>Motion</h2>
          <table class="tk__table">
            <caption>
              Durations and easing curves (honour prefers-reduced-motion at the
              call site)
            </caption>
            <thead>
              <tr>
                <th scope="col">Token</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              @for (t of group('motion'); track t.name) {
                <tr>
                  <th scope="row">
                    <code>{{ t.name }}</code>
                  </th>
                  <td>
                    <code>{{ t.light }}</code>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </section>
      }

      @if (show('breakpoint')) {
        <section>
          <h2>Breakpoints &amp; z-index</h2>
          <table class="tk__table">
            <caption>
              Min-width breakpoints and stacking order
            </caption>
            <thead>
              <tr>
                <th scope="col">Token</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              @for (t of group('breakpoint'); track t.name) {
                <tr>
                  <th scope="row">
                    <code>{{ t.name }}</code>
                  </th>
                  <td>
                    <code>{{ t.light }}</code>
                  </td>
                </tr>
              }
              @for (t of group('z'); track t.name) {
                <tr>
                  <th scope="row">
                    <code>{{ t.name }}</code>
                  </th>
                  <td>
                    <code>{{ t.light }}</code>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </section>
      }
    </article>
  `,
  styles: [
    `
      .tk {
        color: var(--cdf-color-text);
        font-family: var(--cdf-font-family-sans);
        max-width: 1100px;
      }
      .tk h1 {
        margin: 0 0 8px;
        font-size: var(--cdf-font-size-2xl);
      }
      .tk h2 {
        margin: 32px 0 12px;
        font-size: var(--cdf-font-size-xl);
      }
      .tk h3 {
        margin: 24px 0 8px;
        font-size: var(--cdf-font-size-md);
      }
      .tk__lead {
        color: var(--cdf-color-text-muted);
      }
      .tk code {
        font-family: var(--cdf-font-family-mono);
        font-size: 12px;
      }
      .tk__table {
        border-collapse: collapse;
        width: 100%;
        font-size: 13px;
      }
      .tk__table caption {
        text-align: start;
        color: var(--cdf-color-text-muted);
        padding-bottom: 6px;
      }
      .tk__table th,
      .tk__table td {
        border-bottom: 1px solid var(--cdf-color-border);
        padding: 6px 8px;
        text-align: start;
      }
      .tk__swatch {
        display: inline-block;
        width: 28px;
        height: 18px;
        margin-inline-end: 8px;
        vertical-align: middle;
        border: 1px solid var(--cdf-color-border);
        border-radius: 4px;
      }
      .tk__fail {
        color: var(--cdf-color-danger-text);
        font-weight: 700;
      }
      .tk__list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 6px;
      }
      .tk__list li {
        display: grid;
        grid-template-columns: 180px auto 1fr;
        gap: 12px;
        align-items: center;
      }
      .tk__bar {
        display: inline-block;
        height: 12px;
        background: var(--cdf-color-primary);
        border-radius: 2px;
        min-width: 1px;
      }
      .tk__type {
        margin: 4px 0;
      }
      .tk__grid {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 16px;
      }
      .tk__grid li {
        display: flex;
        flex-direction: column;
        gap: 6px;
        align-items: flex-start;
      }
      .tk__box {
        display: block;
        width: 72px;
        height: 48px;
        background: var(--cdf-color-primary-subtle);
        border: 1px solid var(--cdf-color-border);
      }
      .tk__box--shadow {
        background: var(--cdf-color-surface);
        border-radius: 8px;
      }
    `,
  ],
})
export class TokensPage implements OnInit {
  /** Restrict to some groups (default: all). */
  readonly groups = input<TokenGroup[] | null>(null);

  protected readonly surfaces = SURFACE_TOKENS;
  private readonly tokens = signal<Token[]>([]);
  protected readonly total = computed(() => this.tokens().length);

  protected readonly contrast = computed(() => {
    const byName = new Map(this.tokens().map((t) => [t.name, t]));
    return TEXT_TOKENS.filter((n) => byName.has(n)).map((text) => {
      const t = byName.get(text)!;
      const cells: number[] = [];
      for (const s of SURFACE_TOKENS) {
        const surf = byName.get(s);
        for (const theme of ['light', 'dark'] as const) {
          const fg = t[theme];
          const bg = surf?.[theme] ?? '';
          cells.push(isHex(fg) && isHex(bg) ? contrastRatio(fg, bg) : 0);
        }
      }
      return { text, cells };
    });
  });

  ngOnInit(): void {
    const names = declaredTokenNames();
    const light = readTheme(names, 'light');
    const dark = readTheme(names, 'dark');
    this.tokens.set(
      names.map((name) => ({ name, light: light[name], dark: dark[name] })),
    );
  }

  protected show(g: TokenGroup): boolean {
    const only = this.groups();
    return !only || only.includes(g);
  }

  protected group(g: TokenGroup): Token[] {
    const prefix = GROUP_PREFIX.find(([k]) => k === g)?.[1] ?? '';
    return this.tokens().filter((t) => t.name.startsWith(prefix));
  }
}
