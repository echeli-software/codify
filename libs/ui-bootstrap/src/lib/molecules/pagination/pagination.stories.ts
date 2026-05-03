import type { Meta, StoryObj } from '@storybook/angular';
import { Pagination } from './pagination.js';

const meta: Meta<Pagination> = {
  title: 'Molecules/Pagination',
  component: Pagination,
  argTypes: {
    page: { control: { type: 'number', min: 1 } },
    totalPages: { control: { type: 'number', min: 1 } },
    siblingCount: { control: { type: 'number', min: 0, max: 4 } },
  },
};
export default meta;
type Story = StoryObj<Pagination>;

export const Few: Story = { args: { page: 2, totalPages: 5, siblingCount: 1 } };
export const Many: Story = { args: { page: 7, totalPages: 24, siblingCount: 1 } };
export const FirstPage: Story = { args: { page: 1, totalPages: 24 } };
export const LastPage: Story = { args: { page: 24, totalPages: 24 } };
