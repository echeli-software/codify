import { kitchenSinkLessonDoc, type EmbedNode } from '@codify/lesson-schema';
import {
  EmbedMetadataService,
  embedMetadataOptionsFromEnv,
  type FetchFn,
} from './embed-metadata.service.js';

const opts = {
  ...embedMetadataOptionsFromEnv({ OEMBED_ENABLED: 'true' }),
  timeoutMs: 50,
};

function respond(
  body: unknown,
  init: { status?: number; length?: string } = {},
) {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: {
      get: (h: string) =>
        h === 'content-length' ? (init.length ?? null) : null,
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('EmbedMetadataService', () => {
  it('queries only the provider’s fixed oEmbed endpoint with the canonical URL', async () => {
    const fetchFn = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>(
      async () =>
        respond({
          title: 'Never Gonna',
          author_name: 'Rick',
          provider_name: 'YouTube',
          thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        }),
    );
    const svc = new EmbedMetadataService(opts, fetchFn);
    const meta = await svc.lookup(
      'youtube',
      'https://youtu.be/dQw4w9WgXcQ?t=42&evil=http://169.254.169.254/',
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(
      'https://www.youtube.com/oembed?format=json&url=' +
        encodeURIComponent('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    );
    expect(init?.redirect).toBe('error');
    expect(meta).toMatchObject({
      title: 'Never Gonna',
      authorName: 'Rick',
      providerName: 'YouTube',
      thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    });
    // Cached.
    await svc.lookup('youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('never fetches for non-allowlisted URLs or providers without oEmbed', async () => {
    const fetchFn = jest.fn(async () => respond({}));
    const svc = new EmbedMetadataService(opts, fetchFn);
    expect(
      await svc.lookup('youtube', 'https://evil.example/watch?v=dQw4w9WgXcQ'),
    ).toBeNull();
    expect(
      await svc.lookup('stackblitz', 'https://stackblitz.com/edit/demo'),
    ).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('drops non-https thumbnails, oversized bodies, errors and caches failures', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(
        respond({ title: 'x', thumbnail_url: 'http://insecure/x.jpg' }),
      )
      .mockResolvedValueOnce(
        respond('x'.repeat(10), { length: String(10 ** 7) }),
      )
      .mockRejectedValueOnce(new Error('timeout'));
    const svc = new EmbedMetadataService(opts, fetchFn as unknown as FetchFn);
    expect(
      (await svc.lookup('vimeo', 'https://vimeo.com/1'))?.thumbnailUrl,
    ).toBeNull();
    expect(await svc.lookup('vimeo', 'https://vimeo.com/2')).toBeNull();
    expect(await svc.lookup('vimeo', 'https://vimeo.com/3')).toBeNull();
    expect(await svc.lookup('vimeo', 'https://vimeo.com/3')).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('enrich() fills attrs.meta and keeps the doc when disabled', async () => {
    const fetchFn = jest.fn(async () => respond({ title: 'Intro' }));
    const doc = kitchenSinkLessonDoc();
    await new EmbedMetadataService(opts, fetchFn).enrich(doc);
    const embed = doc.content.find((b) => b.type === 'embed') as EmbedNode;
    expect(embed.attrs.meta?.title).toBe('Intro');

    const off = new EmbedMetadataService(
      embedMetadataOptionsFromEnv({ OEMBED_ENABLED: 'false' }),
      fetchFn,
    );
    const doc2 = kitchenSinkLessonDoc();
    await off.enrich(doc2);
    expect(JSON.stringify(doc2)).not.toContain('"meta"');
  });

  it('is off by default under NODE_ENV=test', () => {
    expect(embedMetadataOptionsFromEnv({ NODE_ENV: 'test' }).enabled).toBe(
      false,
    );
    expect(
      embedMetadataOptionsFromEnv({ NODE_ENV: 'production' }).enabled,
    ).toBe(true);
  });
});
