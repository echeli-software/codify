import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  OEMBED_ENDPOINTS,
  canonicalEmbedUrl,
  isAllowedImageSrc,
  walkBlocks,
  type EmbedMeta,
  type EmbedNode,
  type EmbedProvider,
  type LessonDoc,
} from '@codify/lesson-schema';

/** `fetch`-compatible function (injectable for tests). */
export type FetchFn = (
  input: string,
  init?: {
    signal?: AbortSignal;
    headers?: Record<string, string>;
    redirect?: 'error';
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export const EMBED_FETCH = Symbol('EMBED_FETCH');

export interface EmbedMetadataOptions {
  /** OEMBED_ENABLED (default true; false in NODE_ENV=test). */
  enabled: boolean;
  timeoutMs: number;
  /** Success cache lifetime. */
  ttlMs: number;
  /** Failure cache lifetime (don't hammer a provider that is down). */
  negativeTtlMs: number;
  maxEntries: number;
  /** Largest oEmbed response body read. */
  maxBytes: number;
}

export const EMBED_METADATA_OPTIONS = Symbol('EMBED_METADATA_OPTIONS');

export function embedMetadataOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): EmbedMetadataOptions {
  const raw = env['OEMBED_ENABLED']?.trim().toLowerCase();
  const enabled =
    raw === undefined || raw === ''
      ? env['NODE_ENV'] !== 'test'
      : raw === 'true' || raw === '1';
  return {
    enabled,
    timeoutMs: 3000,
    ttlMs: 24 * 60 * 60 * 1000,
    negativeTtlMs: 10 * 60 * 1000,
    maxEntries: 500,
    maxBytes: 64 * 1024,
  };
}

interface CacheEntry {
  meta: EmbedMeta | null;
  expiresAt: number;
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/**
 * oEmbed-style metadata for embeds, fetched when an author saves a lesson
 * (docs/06 §3). SSRF-safe by construction: the request always goes to the
 * provider's FIXED oEmbed endpoint from `OEMBED_ENDPOINTS` (an https host we
 * chose), carrying the canonical URL rebuilt from the parsed ids as a
 * query parameter — never to the author's URL. No redirects are followed,
 * responses are size-capped, every call has a timeout and results (also
 * failures, briefly) are cached in memory. A failure never blocks the save:
 * the block just keeps whatever metadata it had.
 */
@Injectable()
export class EmbedMetadataService {
  private readonly log = new Logger(EmbedMetadataService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly opts: EmbedMetadataOptions;
  private readonly fetchFn: FetchFn;

  constructor(
    @Optional() @Inject(EMBED_METADATA_OPTIONS) opts?: EmbedMetadataOptions,
    @Optional() @Inject(EMBED_FETCH) fetchFn?: FetchFn,
  ) {
    this.opts = opts ?? embedMetadataOptionsFromEnv();
    this.fetchFn = fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  }

  /** Metadata for one embed, or null (unsupported provider / failure). */
  async lookup(
    provider: EmbedProvider,
    url: string,
  ): Promise<EmbedMeta | null> {
    if (!this.opts.enabled) return null;
    const endpoint = OEMBED_ENDPOINTS[provider];
    const canonical = canonicalEmbedUrl(provider, url);
    if (!endpoint || !canonical) return null;
    const key = `${provider}\u0000${canonical}`;
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.meta;

    const meta = await this.fetchMeta(endpoint(canonical));
    if (this.cache.size >= this.opts.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, {
      meta,
      expiresAt:
        Date.now() + (meta ? this.opts.ttlMs : this.opts.negativeTtlMs),
    });
    return meta;
  }

  /**
   * Fill `attrs.meta` of every embed in `doc` (mutates and returns it). Runs
   * the lookups in parallel; existing metadata stays when a lookup fails.
   */
  async enrich<T extends Pick<LessonDoc, 'content'>>(doc: T): Promise<T> {
    if (!this.opts.enabled) return doc;
    const embeds: EmbedNode[] = [];
    walkBlocks(doc, (node) => {
      if (node.type === 'embed') embeds.push(node as EmbedNode);
    });
    await Promise.all(
      embeds.map(async (node) => {
        const meta = await this.lookup(node.attrs.provider, node.attrs.url);
        if (meta) node.attrs.meta = meta;
      }),
    );
    return doc;
  }

  private async fetchMeta(endpoint: string): Promise<EmbedMeta | null> {
    try {
      const res = await this.fetchFn(endpoint, {
        signal: AbortSignal.timeout(this.opts.timeoutMs),
        headers: { accept: 'application/json' },
        redirect: 'error',
      });
      if (!res.ok) return null;
      const length = Number(res.headers.get('content-length') ?? '0');
      if (length > this.opts.maxBytes) return null;
      const body = await res.text();
      if (body.length > this.opts.maxBytes) return null;
      const json = JSON.parse(body) as Record<string, unknown>;
      const thumb = str(json['thumbnail_url'], 2048);
      return {
        title: str(json['title'], 300),
        authorName: str(json['author_name'], 200),
        providerName: str(json['provider_name'], 100),
        thumbnailUrl:
          thumb?.startsWith('https://') && isAllowedImageSrc(thumb)
            ? thumb
            : null,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      this.log.debug(`oEmbed lookup failed: ${(err as Error).message}`);
      return null;
    }
  }
}
