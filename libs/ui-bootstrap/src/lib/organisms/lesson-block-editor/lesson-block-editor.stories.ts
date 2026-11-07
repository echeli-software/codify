import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { emptyLessonDoc, kitchenSinkLessonDoc } from '@codify/lesson-schema';
import { LessonBlockEditor } from './lesson-block-editor.js';
import {
  LESSON_ASSET_UPLOADER,
  type LessonAssetUploader,
} from './lesson-asset-uploader.js';

/** Fake uploader: reports progress for ~1.5s, then returns a placeholder image. */
const fakeUploader: LessonAssetUploader = {
  upload(file, opts) {
    return new Promise((resolve, reject) => {
      let p = 0;
      const timer = setInterval(() => {
        p += 0.2;
        opts?.onProgress?.(Math.min(1, p));
        if (p >= 1) {
          clearInterval(timer);
          if (file.name.includes('fail'))
            reject(new Error('Simulated network error'));
          else
            resolve({
              url:
                'https://placehold.co/800x400/png?text=' +
                encodeURIComponent(file.name),
              assetId: 'asset-' + Date.now(),
            });
        }
      }, 300);
      opts?.signal?.addEventListener('abort', () => clearInterval(timer));
    });
  },
};

const meta: Meta<LessonBlockEditor> = {
  title: 'Organisms/LessonBlockEditor',
  component: LessonBlockEditor,
  decorators: [
    moduleMetadata({
      imports: [FormsModule, JsonPipe, LessonBlockEditor],
      providers: [{ provide: LESSON_ASSET_UPLOADER, useValue: fakeUploader }],
    }),
  ],
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<LessonBlockEditor>;

const frame = (inner: string) =>
  `<div style="padding:24px; max-width:880px;">${inner}</div>`;

export const Empty: Story = {
  render: () => ({
    props: { doc: emptyLessonDoc() },
    template: frame(`<cdf-lesson-block-editor [(ngModel)]="doc" />`),
  }),
};

/** Every block in the lesson schema, including quiz / ref / embed node views. */
export const EveryBlock: Story = {
  render: () => ({
    props: { doc: kitchenSinkLessonDoc() },
    template: frame(`
      <cdf-lesson-block-editor [(ngModel)]="doc" />
      <details style="margin-top:16px"><summary>LessonDoc JSON</summary><pre style="font-size:12px">{{ doc | json }}</pre></details>
    `),
  }),
};

export const Readonly: Story = {
  render: () => ({
    props: { doc: kitchenSinkLessonDoc() },
    template: frame(
      `<cdf-lesson-block-editor [ngModel]="doc" [readonly]="true" />`,
    ),
  }),
};
