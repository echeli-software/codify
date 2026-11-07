import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AssetsClient,
  type AssetKind,
  type AssetView,
} from '@codify/api-client';
import type {
  AssetLibrary,
  AssetPage,
  AssetSummary,
  FileUploaderBackend,
  LessonAssetUploadOptions,
  LessonAssetUploadResult,
  LessonAssetUploader,
  UploadEvent,
} from '@codify/ui-bootstrap';

/** Page size for the media library grid. */
export const ASSET_PAGE_SIZE = 24;

export function toAssetSummary(a: AssetView): AssetSummary {
  return {
    id: a.id,
    url: a.url,
    kind: a.kind,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAt,
  };
}

function abortError(): Error {
  const err = new Error('Upload aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * Wrap `AssetsClient.upload` (presign → PUT with progress → confirm) as the
 * `UploadEvent` stream the ui-bootstrap uploaders consume.
 */
export function uploadAsObservable(
  assets: AssetsClient,
  file: File,
  kind: AssetKind,
): Observable<UploadEvent<AssetSummary>> {
  return new Observable<UploadEvent<AssetSummary>>((sub) => {
    let closed = false;
    assets
      .upload(file, kind, {
        onProgress: (fraction) => {
          if (closed) return;
          const total = file.size || 1;
          sub.next({
            type: 'progress',
            loaded: Math.round(fraction * total),
            total,
          });
        },
      })
      .then((asset) => {
        if (closed) return;
        sub.next({ type: 'done', result: toAssetSummary(asset) });
        sub.complete();
      })
      .catch((err: unknown) => {
        if (!closed) sub.error(err);
      });
    return () => {
      closed = true;
    };
  });
}

/** Default asset kind for a picked file when the caller didn't specify one. */
export function inferAssetKind(file: Pick<File, 'type'>): AssetKind {
  return file.type.startsWith('image/') ? 'IMAGE' : 'OTHER';
}

/** `LESSON_ASSET_UPLOADER`: image blocks in the lesson editor. */
@Injectable({ providedIn: 'root' })
export class AssetsLessonUploader implements LessonAssetUploader {
  private readonly assets = inject(AssetsClient);

  async upload(
    file: File,
    options: LessonAssetUploadOptions = {},
  ): Promise<LessonAssetUploadResult> {
    if (options.signal?.aborted) throw abortError();
    const asset = await this.assets.upload(file, 'IMAGE', {
      onProgress: (f) => {
        if (!options.signal?.aborted) options.onProgress?.(f);
      },
    });
    // The PUT can't be cancelled mid-flight through AssetsClient; honour the
    // abort by discarding the result so the editor doesn't insert it.
    if (options.signal?.aborted) throw abortError();
    return { url: asset.url, assetId: asset.id };
  }
}

/** `FILE_UPLOADER`: generic `cdf-file-uploader` drops (images by default). */
@Injectable({ providedIn: 'root' })
export class AssetsFileUploader implements FileUploaderBackend<AssetSummary> {
  private readonly assets = inject(AssetsClient);

  upload(file: File): Observable<UploadEvent<AssetSummary>> {
    return uploadAsObservable(this.assets, file, inferAssetKind(file));
  }
}

/** `ASSET_LIBRARY`: `cdf-media-library` / `cdf-asset-picker`. */
@Injectable({ providedIn: 'root' })
export class AssetsAssetLibrary implements AssetLibrary {
  private readonly assets = inject(AssetsClient);

  async list(
    kind: AssetKind | null,
    cursor: string | null,
  ): Promise<AssetPage> {
    const page = await this.assets.list({
      kind: kind ?? undefined,
      cursor: cursor ?? undefined,
      limit: ASSET_PAGE_SIZE,
    });
    return {
      items: page.items.map(toAssetSummary),
      nextCursor: page.nextCursor,
    };
  }

  upload(
    file: File,
    kind?: AssetKind | null,
  ): Observable<UploadEvent<AssetSummary>> {
    return uploadAsObservable(this.assets, file, kind ?? inferAssetKind(file));
  }
}
