import { JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { ASSET_LIBRARY } from '../../organisms/media-library/asset-library.token.js';
import { FakeAssetLibrary } from '../../organisms/media-library/fake-asset-library.js';
import { AssetPicker } from './asset-picker.js';

const library = new FakeAssetLibrary();

const meta: Meta<AssetPicker> = {
  title: 'Molecules/AssetPicker',
  component: AssetPicker,
  decorators: [
    moduleMetadata({
      imports: [FormsModule, JsonPipe],
      providers: [{ provide: ASSET_LIBRARY, useValue: library }],
    }),
  ],
};
export default meta;
type Story = StoryObj<AssetPicker>;

export const Empty: Story = {
  render: () => ({
    props: { cover: null },
    template: `
      <div style="max-width: 420px">
        <cdf-asset-picker kind="COVER" [(ngModel)]="cover" />
        <p style="font-size: 13px">Value id: <code>{{ cover?.id ?? '—' }}</code></p>
      </div>`,
  }),
};

export const WithValue: Story = {
  render: () => ({
    props: { cover: library.assets[1] },
    template: `<div style="max-width: 420px"><cdf-asset-picker [(ngModel)]="cover" /></div>`,
  }),
};

export const NonImageAsset: Story = {
  render: () => ({
    props: { doc: library.assets[3] },
    template: `<div style="max-width: 420px"><cdf-asset-picker kind="OTHER" accept=".pdf" [(ngModel)]="doc" /></div>`,
  }),
};
