/**
 * URL allowlists shared by the schema (validation on save), the editor
 * (inline feedback) and the renderer (defense in depth before binding).
 *
 * Decisions (docs/06 §3 marks, docs/14 §3-4):
 *   - Links: `http:`, `https:`, `mailto:`, same-origin absolute paths
 *     (`/courses/x`, but never protocol-relative `//host`) and in-page
 *     anchors (`#section`). Everything else — `javascript:`, `data:`,
 *     `vbscript:`, `file:` … — is rejected.
 *   - Images: `http(s):` URLs or same-origin paths. No `data:` URIs (they
 *     bypass the asset pipeline and can smuggle SVG script).
 *   - Embeds: provider allowlist; the iframe `src` is never the author's URL
 *     but is rebuilt from the ids parsed out of it (`embedSrcFor`). The
 *     same goes for the oEmbed lookup (`OEMBED_ENDPOINTS` + the canonical
 *     URL), so the server only ever contacts fixed provider hosts.
 */

import { EMBED_PROVIDERS, type EmbedProvider } from './types.js';

const MAX_URL_LENGTH = 2048;
// Control characters and whitespace are never valid inside an href we keep.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000- \u007f-\u009f\\]/;

function tryParse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Same-origin absolute path: starts with one `/`, never `//` or `/\`. */
function isRelativePath(value: string): boolean {
  return /^\/(?![/\\])/.test(value) && !UNSAFE_CHARS.test(value);
}

/** True when `href` is allowed on a link mark. */
export function isAllowedHref(href: unknown): href is string {
  if (typeof href !== 'string') return false;
  if (href.length === 0 || href.length > MAX_URL_LENGTH) return false;
  if (href.startsWith('#')) return /^#[A-Za-z0-9\-_:.]*$/.test(href);
  if (href.startsWith('/')) return isRelativePath(href);
  if (UNSAFE_CHARS.test(href)) return false;
  const url = tryParse(href);
  if (!url) return false;
  if (url.protocol === 'mailto:') return url.pathname.length > 0;
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return url.hostname.length > 0;
  }
  return false;
}

/** True when `src` is allowed on an image block. */
export function isAllowedImageSrc(src: unknown): src is string {
  if (typeof src !== 'string') return false;
  if (src.length === 0 || src.length > MAX_URL_LENGTH) return false;
  if (src.startsWith('/')) return isRelativePath(src);
  if (UNSAFE_CHARS.test(src)) return false;
  const url = tryParse(src);
  if (!url) return false;
  return (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    url.hostname.length > 0
  );
}

// ─── Embeds ────────────────────────────────────────────────────────────────

export interface ParsedEmbed {
  provider: EmbedProvider;
  /** Canonical iframe src rebuilt from the parsed ids. */
  embedSrc: string;
  /** Canonical public page URL rebuilt from the parsed ids (oEmbed input). */
  canonicalUrl: string;
}

type EmbedParser = (url: URL) => { src: string; canonical: string } | null;

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

function hostIn(url: URL, hosts: string[]): boolean {
  return hosts.includes(url.hostname.toLowerCase());
}

function seconds(value: string | null): number | null {
  if (!value) return null;
  const m = /^(\d{1,6})s?$/.exec(value);
  return m ? Number(m[1]) : null;
}

const PARSERS: Record<EmbedProvider, EmbedParser> = {
  youtube: (url) => {
    let id: string | null = null;
    if (hostIn(url, ['youtu.be'])) {
      id = url.pathname.slice(1).split('/')[0] ?? null;
    } else if (
      hostIn(url, [
        'youtube.com',
        'www.youtube.com',
        'm.youtube.com',
        'youtube-nocookie.com',
        'www.youtube-nocookie.com',
      ])
    ) {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else {
        const m = /^\/(?:embed|shorts|live)\/([^/]+)\/?$/.exec(url.pathname);
        id = m?.[1] ?? null;
      }
    }
    if (!id || !YT_ID.test(id)) return null;
    const start =
      seconds(url.searchParams.get('start')) ??
      seconds(url.searchParams.get('t'));
    return {
      src: `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}`,
      canonical: `https://www.youtube.com/watch?v=${id}`,
    };
  },
  vimeo: (url) => {
    let id: string | undefined;
    let hash: string | null = null;
    if (hostIn(url, ['vimeo.com', 'www.vimeo.com'])) {
      const m = /^\/(\d{1,12})(?:\/([a-f0-9]{6,20}))?\/?$/.exec(url.pathname);
      id = m?.[1];
      hash = m?.[2] ?? null;
    } else if (hostIn(url, ['player.vimeo.com'])) {
      const m = /^\/video\/(\d{1,12})\/?$/.exec(url.pathname);
      id = m?.[1];
      const h = url.searchParams.get('h');
      hash = h && /^[a-f0-9]{6,20}$/.test(h) ? h : null;
    }
    if (!id) return null;
    return {
      src: `https://player.vimeo.com/video/${id}${hash ? `?h=${hash}` : ''}`,
      canonical: `https://vimeo.com/${id}${hash ? `/${hash}` : ''}`,
    };
  },
  codepen: (url) => {
    if (!hostIn(url, ['codepen.io'])) return null;
    const m =
      /^\/([A-Za-z0-9_-]{1,64})\/(?:pen|embed|full|details)\/([A-Za-z0-9]{1,32})\/?$/.exec(
        url.pathname,
      );
    if (!m) return null;
    return {
      src: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`,
      canonical: `https://codepen.io/${m[1]}/pen/${m[2]}`,
    };
  },
  codesandbox: (url) => {
    if (!hostIn(url, ['codesandbox.io'])) return null;
    const m =
      /^\/(?:s|embed|p\/sandbox|p\/devbox)\/([A-Za-z0-9_-]{1,80})\/?$/.exec(
        url.pathname,
      );
    if (!m) return null;
    return {
      src: `https://codesandbox.io/embed/${m[1]}`,
      canonical: `https://codesandbox.io/s/${m[1]}`,
    };
  },
  loom: (url) => {
    if (!hostIn(url, ['loom.com', 'www.loom.com'])) return null;
    const m = /^\/(?:share|embed)\/([A-Za-z0-9]{8,64})\/?$/.exec(url.pathname);
    if (!m) return null;
    return {
      src: `https://www.loom.com/embed/${m[1]}`,
      canonical: `https://www.loom.com/share/${m[1]}`,
    };
  },
  stackblitz: (url) => {
    if (!hostIn(url, ['stackblitz.com', 'www.stackblitz.com'])) return null;
    // stackblitz.com/edit/<project> or /github/<owner>/<repo>[/tree/<ref>/<path>]
    const edit = /^\/edit\/([A-Za-z0-9_-]{1,80})\/?$/.exec(url.pathname);
    const gh =
      /^\/github\/([A-Za-z0-9_.-]{1,64})\/([A-Za-z0-9_.-]{1,100})(\/tree\/[A-Za-z0-9_./-]{1,200})?\/?$/.exec(
        url.pathname,
      );
    let path: string;
    if (edit) path = `/edit/${edit[1]}`;
    else if (gh && !(gh[3] ?? '').includes('..'))
      path = `/github/${gh[1]}/${gh[2]}${gh[3] ?? ''}`;
    else return null;
    const file = url.searchParams.get('file');
    const fileParam =
      file && /^[A-Za-z0-9_./-]{1,200}$/.test(file) && !file.includes('..')
        ? `&file=${encodeURIComponent(file)}`
        : '';
    return {
      src: `https://stackblitz.com${path}?embed=1${fileParam}`,
      canonical: `https://stackblitz.com${path}`,
    };
  },
  figma: (url) => {
    if (!hostIn(url, ['figma.com', 'www.figma.com'])) return null;
    const m =
      /^\/(file|design|proto|board)\/([A-Za-z0-9]{10,64})(?:\/[^/?#]{0,200})?\/?$/.exec(
        url.pathname,
      );
    if (!m) return null;
    const node = url.searchParams.get('node-id');
    const nodeParam =
      node && /^[0-9]{1,10}[-:][0-9]{1,10}$/.test(node)
        ? `?node-id=${encodeURIComponent(node)}`
        : '';
    const canonical = `https://www.figma.com/${m[1]}/${m[2]}${nodeParam}`;
    return {
      src: `https://www.figma.com/embed?embed_host=codify&url=${encodeURIComponent(canonical)}`,
      canonical,
    };
  },
};

function parseHttpsUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > MAX_URL_LENGTH) return null;
  if (UNSAFE_CHARS.test(raw)) return null;
  const url = tryParse(raw);
  if (!url || url.protocol !== 'https:') return null;
  if (url.username || url.password || url.port) return null;
  return url;
}

/**
 * Canonical iframe src for `url` under `provider`, or null when the URL
 * does not match that provider's host patterns. The renderer uses ONLY this
 * value as the iframe src — never the author-supplied URL.
 */
export function embedSrcFor(provider: unknown, rawUrl: unknown): string | null {
  if (!(EMBED_PROVIDERS as readonly unknown[]).includes(provider)) return null;
  const url = parseHttpsUrl(rawUrl);
  if (!url) return null;
  return PARSERS[provider as EmbedProvider](url)?.src ?? null;
}

/** Canonical public URL for `url` under `provider` (null = not that provider). */
export function canonicalEmbedUrl(
  provider: unknown,
  rawUrl: unknown,
): string | null {
  if (!(EMBED_PROVIDERS as readonly unknown[]).includes(provider)) return null;
  const url = parseHttpsUrl(rawUrl);
  if (!url) return null;
  return PARSERS[provider as EmbedProvider](url)?.canonical ?? null;
}

/** Detect the provider for a pasted URL (editor convenience). */
export function parseEmbedUrl(rawUrl: unknown): ParsedEmbed | null {
  const url = parseHttpsUrl(rawUrl);
  if (!url) return null;
  for (const provider of EMBED_PROVIDERS) {
    const parsed = PARSERS[provider](url);
    if (parsed)
      return { provider, embedSrc: parsed.src, canonicalUrl: parsed.canonical };
  }
  return null;
}

/** Human labels for the allowlisted providers. */
export const EMBED_PROVIDER_LABELS: Record<EmbedProvider, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  codepen: 'CodePen',
  codesandbox: 'CodeSandbox',
  loom: 'Loom',
  stackblitz: 'StackBlitz',
  figma: 'Figma',
};

/**
 * Providers with a public oEmbed endpoint: the FIXED endpoint (our host,
 * never the author's) the API queries on save, given the canonical URL.
 * StackBlitz has none.
 */
export const OEMBED_ENDPOINTS: Partial<
  Record<EmbedProvider, (canonicalUrl: string) => string>
> = {
  youtube: (u) =>
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`,
  vimeo: (u) =>
    `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u)}`,
  codepen: (u) =>
    `https://codepen.io/api/oembed?format=json&url=${encodeURIComponent(u)}`,
  loom: (u) => `https://www.loom.com/v1/oembed?url=${encodeURIComponent(u)}`,
  figma: (u) => `https://www.figma.com/api/oembed?url=${encodeURIComponent(u)}`,
};

/** CSS `aspect-ratio` value for an embed's `aspectRatio` attr (default 16 / 9). */
export function embedAspectRatioCss(ratio: unknown): string {
  const m =
    typeof ratio === 'string' ? /^(\d{1,2}):(\d{1,2})$/.exec(ratio) : null;
  return m ? `${m[1]} / ${m[2]}` : '16 / 9';
}
