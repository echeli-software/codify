import type { Meta, StoryObj } from '@storybook/angular';
import { ItemSprite } from './item-sprite.js';
import { SAMPLE_SPRITE_URLS } from './sample-sprites.js';

const meta: Meta<ItemSprite> = {
  title: 'Atoms/ItemSprite',
  component: ItemSprite,
  render: (args) => ({
    props: args,
    template: `<cdf-item-sprite [token]="token" [url]="url" [size]="size" />`,
  }),
};
export default meta;
type Story = StoryObj<ItemSprite>;

/** An uploaded sprite: the API resolved `spriteUrl`. */
export const UploadedImage: Story = {
  args: {
    token: '01960000-0000-7000-8000-000000000001',
    url: SAMPLE_SPRITE_URLS.crown,
    size: 64,
  },
};

export const EmojiToken: Story = {
  args: { token: 'emoji:🎩', url: null, size: 48 },
};

export const ColorToken: Story = {
  args: { token: 'color:#ffd700', url: null, size: 48 },
};

/** A URL that fails to load falls back to the token rendering. */
export const BrokenImageFallsBack: Story = {
  args: { token: 'emoji:🧢', url: 'data:image/png;base64,AAAA', size: 48 },
};
