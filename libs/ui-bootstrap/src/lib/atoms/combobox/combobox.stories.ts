import { FormsModule } from '@angular/forms';
import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import {
  Combobox,
  type ComboboxOption,
  type ComboboxSource,
} from './combobox.js';

const COURSES: ComboboxOption<string>[] = [
  {
    value: 'react',
    label: 'React Fundamentals',
    description: 'react-fundamentals',
  },
  {
    value: 'angular',
    label: 'Angular Signals',
    description: 'angular-signals',
  },
  { value: 'node', label: 'Node.js APIs', description: 'node-apis' },
  {
    value: 'prompt',
    label: 'Prompt Engineering',
    description: 'prompt-engineering',
  },
  {
    value: 'feedback',
    label: 'Giving Feedback',
    description: 'soft-skills-feedback',
  },
  {
    value: 'legacy',
    label: 'jQuery (archived)',
    description: 'jquery',
    disabled: true,
  },
];

/** Fake async source with latency so the loading state is visible. */
const searchCourses: ComboboxSource<string> = (q) =>
  new Promise((resolve) =>
    setTimeout(
      () =>
        resolve(
          COURSES.filter((c) =>
            c.label.toLowerCase().includes(q.toLowerCase()),
          ),
        ),
      400,
    ),
  );

const meta: Meta<Combobox<string>> = {
  title: 'Atoms/Combobox',
  component: Combobox,
  decorators: [moduleMetadata({ imports: [FormsModule] })],
  parameters: {
    docs: {
      description: {
        component:
          'WAI-ARIA combobox: ↑/↓ move the active option (aria-activedescendant), Enter picks, Esc closes, Home/End jump.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<Combobox<string>>;

export const StaticOptions: Story = {
  render: () => ({
    props: { options: COURSES, picked: null },
    template: `
      <div style="max-width: 360px; min-height: 320px">
        <cdf-combobox [options]="options" ariaLabel="Course" placeholder="Search courses…" [(ngModel)]="picked" />
        <p style="font-size: 13px">Value: <code>{{ picked ?? '—' }}</code></p>
      </div>
    `,
  }),
};

export const AsyncSource: Story = {
  render: () => ({
    props: { source: searchCourses, picked: null },
    template: `
      <div style="max-width: 360px; min-height: 320px">
        <cdf-combobox [source]="source" [minChars]="1" ariaLabel="Course" placeholder="Type to search…" [(ngModel)]="picked" />
        <p style="font-size: 13px">Value: <code>{{ picked ?? '—' }}</code></p>
      </div>
    `,
  }),
};

export const Preselected: Story = {
  render: () => ({
    props: { options: COURSES, picked: 'node' },
    template: `<div style="max-width: 360px"><cdf-combobox [options]="options" ariaLabel="Course" [(ngModel)]="picked" /></div>`,
  }),
};

export const Invalid: Story = {
  render: () => ({
    props: { options: COURSES },
    template: `<div style="max-width: 360px"><cdf-combobox [options]="options" ariaLabel="Course" [invalid]="true" placeholder="Required" /></div>`,
  }),
};
