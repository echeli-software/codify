import { BadRequestException, type ValidationError } from '@nestjs/common';

/**
 * Flatten class-validator errors into `{ "path.to.field": [messages] }`,
 * the `errors` shape of our problem+json bodies.
 */
export function flattenValidationErrors(
  errors: ValidationError[],
  parent = '',
  out: Record<string, string[]> = {},
): Record<string, string[]> {
  for (const e of errors) {
    const path = parent ? `${parent}.${e.property}` : e.property;
    if (e.constraints) {
      out[path] = [...(out[path] ?? []), ...Object.values(e.constraints)];
    }
    if (e.children?.length) flattenValidationErrors(e.children, path, out);
  }
  return out;
}

/** `ValidationPipe.exceptionFactory` producing a structured 400. */
export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  const fields = flattenValidationErrors(errors);
  const messages = Object.values(fields).flat();
  return new BadRequestException({
    message: messages.length ? messages : 'Validation failed',
    code: 'validation.failed',
    errors: fields,
  });
}
