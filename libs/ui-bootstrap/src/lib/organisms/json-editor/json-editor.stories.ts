import type { Meta, StoryObj } from '@storybook/angular';
import { JsonEditor } from './json-editor.js';

const meta: Meta<JsonEditor> = {
  title: 'Organisms/JsonEditor',
  component: JsonEditor,
  argTypes: {
    rows: { control: { type: 'number', min: 4, max: 24 } },
    validate: { control: 'boolean' },
  },
};
export default meta;
type Story = StoryObj<JsonEditor>;

export const Default: Story = { args: { rows: 8, validate: true } };
