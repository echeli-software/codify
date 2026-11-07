import { JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { DateRangePicker, type DateRangePreset } from './date-range-picker.js';

const PRESETS: DateRangePreset[] = [
  { label: 'ui.dateRange.presetWeekend', startOffsetDays: 0, endOffsetDays: 2 },
  { label: 'ui.dateRange.presetWeek', startOffsetDays: 0, endOffsetDays: 6 },
  { label: 'ui.dateRange.presetMonth', startOffsetDays: 0, endOffsetDays: 29 },
];

const meta: Meta<DateRangePicker> = {
  title: 'Molecules/DateRangePicker',
  component: DateRangePicker,
  decorators: [moduleMetadata({ imports: [FormsModule, JsonPipe] })],
};
export default meta;
type Story = StoryObj<DateRangePicker>;

export const Dates: Story = {
  render: () => ({
    props: { range: { start: '2026-11-01', end: '2026-11-30' } },
    template: `
      <div style="max-width: 520px">
        <cdf-date-range-picker legend="Promotion window" [(ngModel)]="range" />
        <p style="font-size: 13px">Value: <code>{{ range | json }}</code></p>
      </div>`,
  }),
};

export const WithTimeAndPresets: Story = {
  render: () => ({
    props: {
      range: { start: null, end: null },
      presets: PRESETS,
      today: new Date(2026, 9, 7),
    },
    template: `
      <div style="max-width: 560px">
        <cdf-date-range-picker legend="Multiplier schedule" [withTime]="true" [presets]="presets" [today]="today" [(ngModel)]="range" />
        <p style="font-size: 13px">Value: <code>{{ range | json }}</code></p>
      </div>`,
  }),
};

export const InvertedRange: Story = {
  render: () => ({
    props: { range: { start: '2026-12-10', end: '2026-12-01' } },
    template: `<div style="max-width: 520px"><cdf-date-range-picker legend="Promotion window" [(ngModel)]="range" /></div>`,
  }),
};

export const OpenEnded: Story = {
  render: () => ({
    props: { range: { start: '2026-10-07', end: null } },
    template: `<div style="max-width: 520px"><cdf-date-range-picker [(ngModel)]="range" /></div>`,
  }),
};
