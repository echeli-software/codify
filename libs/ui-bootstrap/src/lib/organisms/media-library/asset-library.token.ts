import { InjectionToken } from '@angular/core';
import type { Observable } from 'rxjs';
import type { UploadEvent } from '../../molecules/file-uploader/file-uploader.token.js';

/** Mirrors Prisma `AssetKind`. */
export type AssetKind = 'IMAGE' | 'SPRITE' | 'COVER' | 'OTHER';

export const ASSET_KINDS: readonly AssetKind[] = [
  'IMAGE',
  'SPRITE',
  'COVER',
  'OTHER',
];

/** What the media library renders — a subset of the `Asset` row. */
export interface AssetSummary {
  id: string;
  url: string;
  kind: AssetKind;
  mimeType: string;
  sizeBytes: number;
  /** Storage key, e.g. "images/2026/10/<uuid>.png". */
  key?: string;
  /** Display name (falls back to the key's basename). */
  name?: string;
  createdAt?: string;
}

export interface AssetPage {
  items: AssetSummary[];
  /** Opaque keyset cursor for the next page; null at the end. */
  nextCursor: string | null;
}

/**
 * Backend for `cdf-media-library` / `cdf-asset-picker`. The admin app
 * provides it (list → `GET /api/assets?kind&cursor`, upload → presign + PUT
 * + confirm); stories and tests provide in-memory fakes.
 *
 *   providers: [{ provide: ASSET_LIBRARY, useClass: AdminAssetLibrary }]
 */
export interface AssetLibrary {
  list(
    kind: AssetKind | null,
    cursor: string | null,
  ): Observable<AssetPage> | Promise<AssetPage>;
  upload(
    file: File,
    kind?: AssetKind | null,
  ): Observable<UploadEvent<AssetSummary>>;
}

export const ASSET_LIBRARY = new InjectionToken<AssetLibrary>('ASSET_LIBRARY');
