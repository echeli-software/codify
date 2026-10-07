/**
 * Shared @storybook/test-runner hooks: run axe (axe-playwright) on EVERY
 * story, in both the light and the dark theme (docs/03: "Light + dark
 * themes" + "A11y checks pass"). A story can opt out with
 * `parameters.a11y.disable = true` or narrow rules through
 * `parameters.a11y.config.rules` / `parameters.a11y.options`, mirroring the
 * Storybook a11y addon so the panel and CI agree.
 */
import type { TestRunnerConfig } from '@storybook/test-runner';
import { getStoryContext, waitForPageReady } from '@storybook/test-runner';
import { configureAxe, getViolations, injectAxe } from 'axe-playwright';

type Page = Parameters<NonNullable<TestRunnerConfig['postVisit']>>[0];

interface A11yParams {
  disable?: boolean;
  test?: 'off' | 'todo' | 'error';
  config?: { rules?: { id: string; enabled: boolean }[] };
  options?: Record<string, unknown>;
  context?: string;
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => {
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark');
    root.classList.add(`theme-${t}`);
    root.setAttribute('data-theme', t);
  }, theme);
  // Let transitions (token colour changes) settle before measuring contrast.
  await page.waitForTimeout(150);
}

function describe(
  violations: Awaited<ReturnType<typeof getViolations>>,
  theme: string,
): string {
  return violations
    .map((v) => {
      const nodes = v.nodes
        .slice(0, 5)
        .map(
          (n) =>
            `      - ${n.target.join(' ')}\n        ${n.failureSummary?.split('\n').join('\n        ')}`,
        )
        .join('\n');
      return `  [${theme}] ${v.id} (${v.impact}): ${v.help}\n${nodes}`;
    })
    .join('\n');
}

export function createA11yTestRunner(): TestRunnerConfig {
  return {
    async preVisit(page) {
      await injectAxe(page);
    },
    async postVisit(page, context) {
      const storyContext = await getStoryContext(page, context);
      const a11y = (storyContext.parameters?.['a11y'] ?? {}) as A11yParams;
      if (a11y.disable || a11y.test === 'off') return;

      await waitForPageReady(page);
      // `region` ("all content inside landmarks") is page-level advice that an
      // isolated component story can never satisfy.
      await configureAxe(page, {
        rules: [
          { id: 'region', enabled: false },
          ...(a11y.config?.rules ?? []),
        ],
      });

      const target = a11y.context ?? '#storybook-root';
      const failures: string[] = [];
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        const violations = await getViolations(page, target, {
          ...(a11y.options ?? {}),
          // Only WCAG A/AA + best-practice rules that axe marks as reliable.
          runOnly: {
            type: 'tag',
            values: [
              'wcag2a',
              'wcag2aa',
              'wcag21a',
              'wcag21aa',
              'best-practice',
            ],
          },
        });
        if (violations.length) failures.push(describe(violations, theme));
      }
      await setTheme(page, 'light');
      if (failures.length) {
        throw new Error(
          `axe found accessibility violations in "${context.title} › ${context.name}":\n${failures.join('\n')}`,
        );
      }
    },
  };
}

/** Default runner: every story, no exceptions. */
export const a11yTestRunner: TestRunnerConfig = createA11yTestRunner();
