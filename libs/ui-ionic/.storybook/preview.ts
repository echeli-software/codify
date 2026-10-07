import type { Preview } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideI18n } from '@codify/i18n';

// Global SCSS is loaded via the `styles` option on the Storybook target in
// libs/ui-ionic/project.json (Storybook's webpack sass-loader doesn't
// support modern `pkg:` URLs, so Angular's builder handles it instead).

const preview: Preview = {
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    options: {
      storySort: {
        order: ['Foundations', 'Atoms', 'Molecules', 'Organisms', 'Demo'],
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
      providers: [
        provideRouter([{ path: '**', children: [] }], withHashLocation()),
        provideIonicAngular({ mode: 'md' }),
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
