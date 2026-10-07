/**
 * Default Storybook test-runner hooks: run axe on every story (roadmap
 * Phase 2/3: "A11y check (axe) passes on every component").
 *
 * storybook.yml copies this into libs/<lib>/.storybook/test-runner.ts when a
 * library doesn't ship its own, so axe always runs in CI. A story can opt out
 * with `parameters: { a11y: { disable: true } }` or tune rules with
 * `parameters: { a11y: { config: { rules: [...] } } }` — the same parameters
 * @storybook/addon-a11y reads in the Storybook UI.
 */
import type { TestRunnerConfig } from '@storybook/test-runner';
import { getStoryContext } from '@storybook/test-runner';
import { checkA11y, configureAxe, injectAxe } from 'axe-playwright';

const config: TestRunnerConfig = {
  async preVisit(page) {
    await injectAxe(page);
  },
  async postVisit(page, context) {
    const story = await getStoryContext(page, context);
    const a11y = (story.parameters?.['a11y'] ?? {}) as {
      disable?: boolean;
      config?: { rules?: { id: string; enabled?: boolean }[] };
    };
    if (a11y.disable) return;
    await configureAxe(page, { rules: a11y.config?.rules ?? [] });
    await checkA11y(page, '#storybook-root', {
      detailedReport: true,
      detailedReportOptions: { html: true },
    });
  },
};

export default config;
