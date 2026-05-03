import type { Preview } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideI18n } from '@codify/i18n';

// Global SCSS is loaded via the `styles` option on the Storybook target in
// libs/ui-bootstrap/project.json (Storybook's webpack sass-loader doesn't
// support modern `pkg:` URLs, so we go through Angular's builder instead).

const preview: Preview = {
  parameters: {
    layout: 'padded',
    a11y: {
      // Surface axe violations in the addon panel; do not block stories yet —
      // fix as we iterate per docs/03 §"Done when".
      test: 'todo',
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    options: {
      storySort: {
        order: ['Atoms', 'Molecules', 'Organisms'],
      },
    },
  },
  globalTypes: {
    theme: {
      description: 'Codify theme',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    applicationConfig({
      // withHashLocation isolates the router from Storybook's iframe URL so
      // RouterLink works for stories without triggering NG04002 against
      // /iframe.html. The wildcard route catches anything we forgot to mock.
      providers: [
        provideRouter([{ path: '**', children: [] }], withHashLocation()),
        provideI18n(),
      ],
    }),
    (storyFn, ctx) => {
      const theme = (ctx.globals as { theme?: string }).theme ?? 'light';
      const root = document.documentElement;
      root.classList.remove('theme-light', 'theme-dark');
      root.classList.add(theme === 'dark' ? 'theme-dark' : 'theme-light');
      return storyFn();
    },
  ],
};

export default preview;
