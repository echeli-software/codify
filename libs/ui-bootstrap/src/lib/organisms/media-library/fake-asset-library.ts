import { Observable } from 'rxjs';
import type { UploadEvent } from '../../molecules/file-uploader/file-uploader.token.js';
import type {
  AssetKind,
  AssetLibrary,
  AssetPage,
  AssetSummary,
} from './asset-library.token.js';

/** Deterministic SVG swatch as a data URL (no network in stories/tests). */
function swatch(hue: number, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="hsl(${hue} 70% 55%)"/><text x="160" y="135" font-size="36" font-family="sans-serif" text-anchor="middle" fill="#fff">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * In-memory `ASSET_LIBRARY` for Storybook and unit tests: 23 seeded assets,
 * page size 8, keyset-style string cursors, uploads with fake progress.
 */
export class FakeAssetLibrary implements AssetLibrary {
  readonly assets: AssetSummary[];

  constructor(
    private readonly pageSize = 8,
    private readonly delayMs = 150,
  ) {
    const kinds: AssetKind[] = ['IMAGE', 'COVER', 'SPRITE', 'OTHER'];
    this.assets = Array.from({ length: 23 }, (_, i) => {
      const kind = kinds[i % kinds.length];
      return {
        id: `asset-${i + 1}`,
        kind,
        url:
          kind === 'OTHER'
            ? `https://cdn.example/docs/file-${i + 1}.pdf`
            : swatch((i * 47) % 360, `#${i + 1}`),
        mimeType: kind === 'OTHER' ? 'application/pdf' : 'image/svg+xml',
        sizeBytes: 12_000 + i * 1_000,
        key: `${kind.toLowerCase()}s/2026/10/${kind.toLowerCase()}-${i + 1}.${kind === 'OTHER' ? 'pdf' : 'svg'}`,
      };
    });
  }

  list(kind: AssetKind | null, cursor: string | null): Promise<AssetPage> {
    const filtered = kind
      ? this.assets.filter((a) => a.kind === kind)
      : this.assets;
    const start = cursor ? Number(cursor) : 0;
    const items = filtered.slice(start, start + this.pageSize);
    const next =
      start + this.pageSize < filtered.length
        ? String(start + this.pageSize)
        : null;
    return new Promise((resolve) =>
      setTimeout(() => resolve({ items, nextCursor: next }), this.delayMs),
    );
  }

  upload(
    file: File,
    kind: AssetKind | null = null,
  ): Observable<UploadEvent<AssetSummary>> {
    return new Observable((sub) => {
      let loaded = 0;
      const timer = setInterval(() => {
        loaded += Math.max(1, file.size / 4);
        if (loaded < file.size) {
          sub.next({ type: 'progress', loaded, total: file.size });
          return;
        }
        clearInterval(timer);
        const asset: AssetSummary = {
          id: `upload-${Date.now()}`,
          kind: kind ?? 'IMAGE',
          url: swatch(200, 'new'),
          mimeType: file.type || 'image/svg+xml',
          sizeBytes: file.size,
          name: file.name,
        };
        this.assets.unshift(asset);
        sub.next({ type: 'done', result: asset });
        sub.complete();
      }, this.delayMs);
      return () => clearInterval(timer);
    });
  }
}
