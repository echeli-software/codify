import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { ASSET_LIBRARY, type AssetLibrary } from './asset-library.token.js';
import { FakeAssetLibrary } from './fake-asset-library.js';
import { MediaLibrary } from './media-library.js';

const failing: AssetLibrary = {
  list: () => Promise.reject(new Error('offline')),
  upload: () => {
    throw new Error('offline');
  },
};

const meta: Meta<MediaLibrary> = {
  title: 'Organisms/MediaLibrary',
  component: MediaLibrary,
  decorators: [
    moduleMetadata({
      providers: [
        { provide: ASSET_LIBRARY, useFactory: () => new FakeAssetLibrary() },
      ],
    }),
  ],
};
export default meta;
type Story = StoryObj<MediaLibrary>;

export const AllKinds: Story = {
  render: () => ({
    props: { selected: null },
    template: `
      <div style="max-width: 760px">
        <cdf-media-library [(selectedId)]="selected" />
        <p style="font-size: 13px">Selected: <code>{{ selected ?? '—' }}</code></p>
      </div>`,
  }),
};

export const CoversOnly: Story = {
  render: () => ({
    template: `<div style="max-width: 760px"><cdf-media-library kind="COVER" [allowUpload]="false" /></div>`,
  }),
};

export const LoadError: Story = {
  decorators: [
    moduleMetadata({
      providers: [{ provide: ASSET_LIBRARY, useValue: failing }],
    }),
  ],
  render: () => ({
    template: `<div style="max-width: 760px"><cdf-media-library [allowUpload]="false" /></div>`,
  }),
};
