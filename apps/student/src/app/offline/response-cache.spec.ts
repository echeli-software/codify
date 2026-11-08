import { ProblemDetailsError } from '@codify/api-client';
import {
  clearResponses,
  loadResponse,
  saveResponse,
  withResponseCache,
} from './response-cache';

describe('response cache (docs/16 §3)', () => {
  afterEach(() => localStorage.clear());

  it('is scoped per user', () => {
    saveResponse('u1', 'catalog', { n: 1 }, 1000);
    expect(loadResponse('u1', 'catalog')).toEqual({
      value: { n: 1 },
      savedAt: 1000,
    });
    expect(loadResponse('u2', 'catalog')).toBeNull();
    expect(loadResponse(null, 'catalog')).toBeNull();
    saveResponse('u2', 'x', 1);
    expect(clearResponses('u1')).toBe(1);
    expect(loadResponse('u2', 'x')?.value).toBe(1);
  });

  it('saves live responses and falls back to them on a network failure', async () => {
    const live = await withResponseCache('u1', 'k', true, async () => [1, 2]);
    expect(live).toEqual({ value: [1, 2], fromCache: null });
    const failed = await withResponseCache('u1', 'k', true, () =>
      Promise.reject(new ProblemDetailsError({ status: 0 })),
    );
    expect(failed.value).toEqual([1, 2]);
    expect(typeof failed.fromCache).toBe('number');
    const offline = await withResponseCache('u1', 'k', false, () => {
      throw new Error('must not be called offline');
    });
    expect(offline.value).toEqual([1, 2]);
  });

  it('rethrows server errors and fails offline without a cached copy', async () => {
    await expect(
      withResponseCache('u1', 'k2', true, () =>
        Promise.reject(new ProblemDetailsError({ status: 500 })),
      ),
    ).rejects.toMatchObject({ status: 500 });
    await expect(
      withResponseCache('u1', 'k3', false, async () => 1),
    ).rejects.toMatchObject({ status: 0 });
  });
});
