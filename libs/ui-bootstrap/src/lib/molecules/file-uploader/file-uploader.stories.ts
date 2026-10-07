import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { Observable, throwError } from 'rxjs';
import { Button } from '../../atoms/button/button.js';
import { FileUploader } from './file-uploader.js';
import {
  FILE_UPLOADER,
  type FileUploaderBackend,
  type UploadEvent,
} from './file-uploader.token.js';

/** Fake backend: 5 progress ticks then done with a fake URL. */
const fakeBackend: FileUploaderBackend<{ url: string }> = {
  upload: (file) =>
    new Observable<UploadEvent<{ url: string }>>((sub) => {
      let loaded = 0;
      const timer = setInterval(() => {
        loaded += file.size / 5;
        if (loaded >= file.size) {
          clearInterval(timer);
          sub.next({
            type: 'done',
            result: { url: `https://cdn.example/${file.name}` },
          });
          sub.complete();
        } else {
          sub.next({ type: 'progress', loaded, total: file.size });
        }
      }, 300);
      return () => clearInterval(timer);
    }),
};

const failingBackend: FileUploaderBackend = {
  upload: () => throwError(() => new Error('Network down')),
};

const meta: Meta<FileUploader> = {
  title: 'Molecules/FileUploader',
  component: FileUploader,
  decorators: [
    moduleMetadata({
      imports: [Button],
      providers: [{ provide: FILE_UPLOADER, useValue: fakeBackend }],
    }),
  ],
};
export default meta;
type Story = StoryObj<FileUploader>;

export const Images: Story = {
  render: () => ({
    template: `<div style="max-width: 480px"><cdf-file-uploader accept="image/*" [maxSizeBytes]="5242880" /></div>`,
  }),
};

export const MultipleFiles: Story = {
  render: () => ({
    template: `<div style="max-width: 480px"><cdf-file-uploader [multiple]="true" hint="PNG, SVG or WebP — up to 10 files" /></div>`,
  }),
};

/** Shows the per-file rows (in progress, done, rejected, failed). */
export const WithItems: Story = {
  render: () => ({
    props: {
      seed: (up: FileUploader) => {
        up.addFiles([
          new File([new Uint8Array(400_000)], 'course-cover.png', {
            type: 'image/png',
          }),
          new File([new Uint8Array(12_000_000)], 'huge-video.mp4', {
            type: 'video/mp4',
          }),
        ]);
      },
    },
    template: `
      <div style="max-width: 480px">
        <cdf-file-uploader #up accept="image/*,video/*" [maxSizeBytes]="5242880" [multiple]="true" />
        <cdf-button kind="secondary" size="sm" (click)="seed(up)">Add sample files</cdf-button>
      </div>
    `,
  }),
};

export const FailingBackend: Story = {
  render: () => ({
    props: { backend: failingBackend },
    template: `<div style="max-width: 480px"><cdf-file-uploader [backend]="backend" /></div>`,
  }),
};

export const Disabled: Story = {
  render: () => ({
    template: `<div style="max-width: 480px"><cdf-file-uploader [disabled]="true" /></div>`,
  }),
};
