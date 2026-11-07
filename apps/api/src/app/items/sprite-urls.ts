import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Item sprites (`Item.spriteAssetId`, docs/08) are one of:
 *   - an inline token rendered by the client: `emoji:🧢`, `color:#ffd700`;
 *   - an uploaded `Asset` id (UUID) — rendered from `Asset.url`;
 *   - an absolute `http(s)://` URL or a root-relative `/path` (legacy seeds).
 *
 * API responses carry a resolved `spriteUrl` next to the raw id so clients
 * never need to know about assets: the image URL, or null for inline tokens
 * and ids that no longer resolve.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the sprite reference is an uploaded Asset id. */
export function isAssetSpriteRef(ref: string | null | undefined): boolean {
  return typeof ref === 'string' && UUID_RE.test(ref);
}

/** Asset id → public URL, for every asset sprite among `refs`. */
export type SpriteUrlMap = ReadonlyMap<string, string>;

type AssetReader = Pick<PrismaService, 'asset'>;

/**
 * Resolve the Asset ids among `refs` in **one** query (none when there is
 * nothing to resolve). Unknown ids are simply absent from the map.
 */
export async function loadSpriteUrls(
  prisma: AssetReader,
  refs: Iterable<string | null | undefined>,
): Promise<SpriteUrlMap> {
  const ids = [
    ...new Set([...refs].filter((r): r is string => isAssetSpriteRef(r))),
  ];
  if (ids.length === 0) return new Map();
  const rows = await prisma.asset.findMany({
    where: { id: { in: ids } },
    select: { id: true, url: true },
  });
  return new Map(rows.map((r) => [r.id, r.url]));
}

/** The renderable URL for a sprite ref, or null (inline token / unknown). */
export function spriteUrlFor(
  ref: string | null | undefined,
  urls: SpriteUrlMap,
): string | null {
  if (!ref) return null;
  if (isAssetSpriteRef(ref)) return urls.get(ref) ?? null;
  if (/^https?:\/\//i.test(ref)) return ref;
  if (ref.startsWith('/') && !ref.startsWith('//')) return ref;
  return null;
}
