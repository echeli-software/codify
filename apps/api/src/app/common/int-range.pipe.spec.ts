import { BadRequestException } from '@nestjs/common';
import { IntRangePipe } from './int-range.pipe.js';

const meta = { type: 'query' as const, data: 'skip' };

describe('IntRangePipe', () => {
  it('parses integers within range', () => {
    expect(new IntRangePipe(0).transform('5', meta)).toBe(5);
    expect(new IntRangePipe(0).transform(0, meta)).toBe(0);
  });

  it('rejects values below the minimum (negative skip/take)', () => {
    expect(() => new IntRangePipe(0).transform('-1', meta)).toThrow(
      BadRequestException,
    );
    expect(() => new IntRangePipe(1).transform('0', meta)).toThrow(
      BadRequestException,
    );
  });

  it('rejects non-integers', () => {
    expect(() => new IntRangePipe(0).transform('1.5', meta)).toThrow(
      BadRequestException,
    );
    expect(() => new IntRangePipe(0).transform('abc', meta)).toThrow(
      BadRequestException,
    );
  });

  it('clamps values above the maximum', () => {
    expect(new IntRangePipe(1, 100).transform('500', meta)).toBe(100);
  });
});
