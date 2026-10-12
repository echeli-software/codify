import { StaleGuard } from './stale-guard';

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>(
    (res, rej) => ((resolve = res), (reject = rej)),
  );
  return { promise, resolve, reject };
};

describe('StaleGuard', () => {
  it('drops a slow older response once a newer request started', async () => {
    const g = new StaleGuard();
    const a = deferred<string>();
    const b = deferred<string>();
    const ra = g.run(() => a.promise);
    const rb = g.run(() => b.promise);
    b.resolve('new');
    a.resolve('old');
    expect(await rb).toEqual({ stale: false, ok: true, value: 'new' });
    expect(await ra).toEqual({ stale: true });
  });

  it('reports errors of the current request and cancels on demand', async () => {
    const g = new StaleGuard();
    expect(await g.run(() => Promise.reject(new Error('x')))).toMatchObject({
      stale: false,
      ok: false,
    });
    const p = g.run(() => Promise.resolve(1));
    g.cancel();
    expect(await p).toEqual({ stale: true });
  });
});
