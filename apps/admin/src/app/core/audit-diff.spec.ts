import { diffRows, filterBoundToIso, showValue } from './audit-diff';

describe('diffRows', () => {
  it('pairs before/after fields and flags changes', () => {
    expect(
      diffRows({
        before: { name: 'Hats', sortOrder: 1 },
        after: { name: 'Caps', sortOrder: 1 },
        reason: 'rename',
      }),
    ).toEqual([
      { field: 'name', before: 'Hats', after: 'Caps', changed: true },
      { field: 'sortOrder', before: '1', after: '1', changed: false },
      { field: 'reason', before: null, after: 'rename', changed: false },
    ]);
  });

  it('treats a flat object as the change set', () => {
    expect(diffRows({ itemId: 'i1', tags: ['a'] })).toEqual([
      { field: 'itemId', before: null, after: 'i1', changed: true },
      { field: 'tags', before: null, after: '["a"]', changed: true },
    ]);
  });

  it('handles empty and scalar diffs', () => {
    expect(diffRows(null)).toEqual([]);
    expect(diffRows(42)).toEqual([
      { field: 'value', before: null, after: '42', changed: true },
    ]);
    expect(showValue(undefined)).toBeNull();
  });
});

describe('filterBoundToIso', () => {
  it('expands dates to the start/end of the local day', () => {
    const start = filterBoundToIso('2026-11-01', 'start');
    const end = filterBoundToIso('2026-11-01', 'end');
    expect(new Date(start as string).getHours()).toBe(0);
    expect(new Date(end as string).getHours()).toBe(23);
    expect(filterBoundToIso('', 'start')).toBeUndefined();
    expect(filterBoundToIso('nope', 'start')).toBeUndefined();
  });
});
