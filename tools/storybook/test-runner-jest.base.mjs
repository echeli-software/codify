// Shared Jest config for @storybook/test-runner in both UI libs. Imported by
// libs/<lib>/.storybook/test-runner-jest.config.js.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getJestConfig } from '@storybook/test-runner';

/**
 * Use the pre-installed Chromium instead of downloading the revision the
 * installed Playwright expects. Override with CHROMIUM_EXECUTABLE.
 */
function chromiumExecutable() {
  if (process.env.CHROMIUM_EXECUTABLE) return process.env.CHROMIUM_EXECUTABLE;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && existsSync(join(base, 'chromium'))) return join(base, 'chromium');
  return undefined;
}

/**
 * @param {{ ignoreStoryFiles?: string[] }} [opts] — `ignoreStoryFiles` are
 *   regexes (jest `testPathIgnorePatterns`) for story files another stream
 *   owns; they are skipped entirely (smoke + a11y) in this lib's run.
 */
export function storybookJestConfig(opts = {}) {
  const base = getJestConfig();
  const executablePath = chromiumExecutable();
  return {
    ...base,
    testPathIgnorePatterns: [
      ...(base.testPathIgnorePatterns ?? ['/node_modules/']),
      ...(opts.ignoreStoryFiles ?? []),
    ],
    testTimeout: 60_000,
    testEnvironmentOptions: {
      'jest-playwright': {
        ...base.testEnvironmentOptions['jest-playwright'],
        browsers: ['chromium'],
        launchOptions: {
          ...(executablePath ? { executablePath } : {}),
          args: ['--no-sandbox', '--disable-dev-shm-usage'],
        },
      },
    },
  };
}
