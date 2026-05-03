import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { Badge } from '../../atoms/badge/badge.js';
import { IconButton } from '../../atoms/icon-button/icon-button.js';
import { DataTable, DataTableCell, type DataTableColumn } from './data-table.js';

interface Row {
  id: string;
  title: string;
  author: string;
  status: 'draft' | 'published' | 'archived';
  lessons: number;
}

const ROWS: Row[] = [
  { id: '1', title: 'React Fundamentals', author: 'Maria S.', status: 'published', lessons: 12 },
  { id: '2', title: 'Capybara Capybara', author: 'João P.', status: 'draft', lessons: 3 },
  { id: '3', title: 'Prompt engineering', author: 'Ana T.', status: 'published', lessons: 8 },
  { id: '4', title: 'Capacitor for Angular', author: 'Lucas K.', status: 'archived', lessons: 10 },
];

const COLUMNS: DataTableColumn<Row>[] = [
  { key: 'title', label: 'Title', value: (r) => r.title, sortable: true },
  { key: 'author', label: 'Author', value: (r) => r.author, sortable: true },
  { key: 'status', label: 'Status', value: (r) => r.status, sortable: true, width: '120px' },
  { key: 'lessons', label: 'Lessons', value: (r) => r.lessons, sortable: true, width: '90px', align: 'end' },
];

const meta: Meta<DataTable<Row>> = {
  title: 'Organisms/DataTable',
  component: DataTable,
  decorators: [moduleMetadata({ imports: [DataTable, DataTableCell, Badge, IconButton] })],
};
export default meta;
type Story = StoryObj<DataTable<Row>>;

export const SortableWithBulkSelect: Story = {
  render: () => ({
    props: { rows: ROWS, columns: COLUMNS },
    template: `
      <cdf-data-table [rows]="rows" [columns]="columns" [selectable]="true">
        <ng-template cdfDataTableCell="status" let-row>
          <cdf-badge [variant]="row.status === 'published' ? 'success' : row.status === 'draft' ? 'warning' : 'neutral'" [subtle]="true">
            {{ row.status }}
          </cdf-badge>
        </ng-template>
      </cdf-data-table>
    `,
  }),
};

export const Empty: Story = {
  render: () => ({
    props: { rows: [], columns: COLUMNS },
    template: `<cdf-data-table [rows]="rows" [columns]="columns" emptyMessage="No courses match the filter." />`,
  }),
};
