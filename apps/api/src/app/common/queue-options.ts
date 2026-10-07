/**
 * BullMQ root options from REDIS_URL. Production without REDIS_URL fails at
 * boot (env validation already requires it there; this is the belt to that
 * brace); dev defaults to a local Redis, and every producer falls back to
 * inline work with a warning when it is not running.
 */
export function bullRootOptions(env: NodeJS.ProcessEnv = process.env) {
  const url = env['REDIS_URL']?.trim();
  if (!url && env['NODE_ENV'] === 'production') {
    throw new Error(
      'REDIS_URL is required in production (code submissions, billing webhooks and deferred pushes run through BullMQ queues).',
    );
  }
  return {
    prefix: env['BULLMQ_PREFIX']?.trim() || 'codify',
    connection: {
      url: url || 'redis://127.0.0.1:6379',
      // Back off instead of hammering a missing dev Redis.
      retryStrategy: (times: number) => Math.min(times * 500, 10_000),
    },
  };
}

/** Resolve `p`, or `fallback` after `ms` (unref'd so it never holds the process open). */
export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) =>
      setTimeout(() => resolve(fallback), ms).unref?.(),
    ),
  ]);
}

/**
 * Is the queue's Redis connection usable right now? Waits at most `ms` so a
 * missing dev Redis degrades to the inline fallback instead of hanging.
 */
export function queueReady(
  queue: { waitUntilReady(): Promise<unknown> },
  ms = 750,
): Promise<boolean> {
  return withTimeout(
    queue.waitUntilReady().then(
      () => true,
      () => false,
    ),
    ms,
    false,
  );
}
