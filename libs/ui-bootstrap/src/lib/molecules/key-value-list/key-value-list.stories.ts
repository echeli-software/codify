import type { Meta, StoryObj } from '@storybook/angular';
import { KeyValueList, type KeyValueRow } from './key-value-list.js';

const ROWS: KeyValueRow[] = [
  { key: 'Author', value: 'Maria Souza' },
  { key: 'Source locale', value: 'pt-BR' },
  { key: 'Difficulty', value: 'Intermediário' },
  { key: 'Lessons', value: 12 },
  { key: 'Duration', value: '~3h', hint: 'estimated' },
  { key: 'Status', value: 'Published' },
];

const meta: Meta<KeyValueList> = {
  title: 'Molecules/KeyValueList',
  component: KeyValueList,
  args: { rows: ROWS },
};
export default meta;
type Story = StoryObj<KeyValueList>;

export const CourseDetails: Story = {};
