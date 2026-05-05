import { uuidV4 } from './idempotency.js';

describe('uuidV4', () => {
  it('produces RFC 4122 v4 strings', () => {
    const id = uuidV4();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('generates distinct ids', () => {
    const a = uuidV4();
    const b = uuidV4();
    expect(a).not.toEqual(b);
  });
});
