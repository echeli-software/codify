import type { Meta, StoryObj } from '@storybook/angular';
import { CodeEditor } from './code-editor.js';

const meta: Meta<CodeEditor> = {
  title: 'Molecules/CodeEditor',
  component: CodeEditor,
  args: {
    value: 'function sum(a, b) {\n  return a + b;\n}\n',
    language: 'javascript',
    label: 'Your code',
  },
};
export default meta;
type Story = StoryObj<CodeEditor>;

/** Monaco on devices with a fine pointer; textarea on touch-only devices. */
export const Default: Story = {};
export const ReadOnly: Story = { args: { readonly: true } };
export const Html: Story = {
  args: {
    language: 'web',
    value: '<h1>Hi</h1>\n<style>h1 { color: red; }</style>\n',
  },
};
export const Plain: Story = { args: { plain: true } };
