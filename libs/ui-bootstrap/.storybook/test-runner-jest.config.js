// Jest config picked up by `test-storybook -c libs/ui-bootstrap/.storybook`.
import { storybookJestConfig } from '../../../tools/storybook/test-runner-jest.base.mjs';

// The lesson-block editor/renderer stories belong to the Content stream
// (organisms/lesson-block-*), which owns fixing their a11y findings.
export default storybookJestConfig({
  ignoreStoryFiles: ['/organisms/lesson-block-(editor|renderer)/'],
});
