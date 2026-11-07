import {
  isAssetSpriteRef,
  loadSpriteUrls,
  spriteUrlFor,
} from './sprite-urls.js';

const ASSET = '01960000-0000-7000-8000-000000000001';
const OTHER = '01960000-0000-7000-8000-000000000002';

function fakePrisma(rows: { id: string; url: string }[]) {
  const findMany = jest.fn(
    async ({ where }: { where: { id: { in: string[] } } }) =>
      rows.filter((r) => where.id.in.includes(r.id)),
  );
  return { prisma: { asset: { findMany } } as never, findMany };
}

describe('sprite urls', () => {
  it('recognises uploaded Asset ids only', () => {
    expect(isAssetSpriteRef(ASSET)).toBe(true);
    expect(isAssetSpriteRef('emoji:🧢')).toBe(false);
    expect(isAssetSpriteRef('color:#fff')).toBe(false);
    expect(isAssetSpriteRef(null)).toBe(false);
  });

  it('resolves every asset sprite in one query, deduplicated', async () => {
    const { prisma, findMany } = fakePrisma([
      { id: ASSET, url: 'https://cdn.example/a.png' },
    ]);
    const urls = await loadSpriteUrls(prisma, [
      ASSET,
      'emoji:🎩',
      ASSET,
      OTHER,
      null,
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where.id.in).toEqual([ASSET, OTHER]);
    expect(spriteUrlFor(ASSET, urls)).toBe('https://cdn.example/a.png');
    // Unknown / deleted asset → no URL (the client falls back to the token).
    expect(spriteUrlFor(OTHER, urls)).toBeNull();
  });

  it('skips the query when nothing needs resolving', async () => {
    const { prisma, findMany } = fakePrisma([]);
    const urls = await loadSpriteUrls(prisma, ['emoji:🐉', 'color:#ffd700']);
    expect(findMany).not.toHaveBeenCalled();
    expect(urls.size).toBe(0);
  });

  it('maps inline tokens to null and passes URLs through', () => {
    const none = new Map<string, string>();
    expect(spriteUrlFor('emoji:🧢', none)).toBeNull();
    expect(spriteUrlFor('color:#ffd700', none)).toBeNull();
    expect(spriteUrlFor('https://cdn.example/x.svg', none)).toBe(
      'https://cdn.example/x.svg',
    );
    expect(spriteUrlFor('/img/x.png', none)).toBe('/img/x.png');
    expect(spriteUrlFor('//evil.example/x.png', none)).toBeNull();
    expect(spriteUrlFor('javascript:alert(1)', none)).toBeNull();
  });
});
