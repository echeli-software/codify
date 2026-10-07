import {
  BadRequestException,
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';

/**
 * Parse an integer query/path param and enforce bounds — e.g. pagination
 * `skip` (≥ 0) and `take` (≥ 1). Values above `max` are clamped (so a
 * greedy `take` just gets the max page), values below `min` are rejected.
 * Pair with DefaultValuePipe for optional params.
 */
@Injectable()
export class IntRangePipe implements PipeTransform<unknown, number> {
  constructor(
    private readonly min: number,
    private readonly max = Number.MAX_SAFE_INTEGER,
  ) {}

  transform(value: unknown, meta: ArgumentMetadata): number {
    const name = meta.data ?? 'value';
    const n =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && /^-?\d+$/.test(value.trim())
          ? Number(value)
          : NaN;
    if (!Number.isSafeInteger(n)) {
      throw new BadRequestException({
        message: `${name} must be an integer`,
        code: 'validation.failed',
        errors: { [name]: ['must be an integer'] },
      });
    }
    if (n < this.min) {
      throw new BadRequestException({
        message: `${name} must not be less than ${this.min}`,
        code: 'validation.failed',
        errors: { [name]: [`must not be less than ${this.min}`] },
      });
    }
    return Math.min(n, this.max);
  }
}
