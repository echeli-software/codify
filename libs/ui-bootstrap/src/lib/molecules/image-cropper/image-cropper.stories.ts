import type { Meta, StoryObj } from '@storybook/angular';
import { ImageCropper } from './image-cropper.js';

/** Inline SVG so the story needs no network / binary assets. */
const SAMPLE = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#6a2bff"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs>
  <rect width="1600" height="1000" fill="url(#g)"/>
  <circle cx="420" cy="380" r="220" fill="#ffffff" opacity="0.25"/>
  <rect x="900" y="520" width="480" height="300" rx="40" fill="#111827" opacity="0.35"/>
  <text x="800" y="540" font-family="sans-serif" font-size="140" text-anchor="middle" fill="#fff">Codify</text>
</svg>`)}`;

const meta: Meta<ImageCropper> = {
  title: 'Molecules/ImageCropper',
  component: ImageCropper,
  argTypes: {
    aspectRatio: { control: { type: 'number', step: 0.05 } },
    outputWidth: { control: 'number' },
    outputType: {
      control: 'inline-radio',
      options: ['image/jpeg', 'image/png', 'image/webp'],
    },
  },
};
export default meta;
type Story = StoryObj<ImageCropper>;

export const CourseCover16x9: Story = {
  args: { src: SAMPLE, aspectRatio: 16 / 9, outputWidth: 1280 },
};

export const SquareThumbnail: Story = {
  args: {
    src: SAMPLE,
    aspectRatio: 1,
    outputWidth: 512,
    outputType: 'image/png',
  },
};

export const Empty: Story = { args: { src: null } };
