import { filenameFromDisposition } from './admin-ops.client.js';

describe('filenameFromDisposition', () => {
  it('reads quoted and bare filenames', () => {
    expect(
      filenameFromDisposition(
        'attachment; filename="audit-2026-11-07T120000.csv"',
        'x.csv',
      ),
    ).toBe('audit-2026-11-07T120000.csv');
    expect(filenameFromDisposition('attachment; filename=a.csv', 'x')).toBe(
      'a.csv',
    );
  });

  it('falls back without a header', () => {
    expect(filenameFromDisposition(null, 'audit.csv')).toBe('audit.csv');
    expect(filenameFromDisposition('inline', 'audit.csv')).toBe('audit.csv');
  });
});
