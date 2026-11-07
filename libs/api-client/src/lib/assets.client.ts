import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpEventType, HttpRequest } from '@angular/common/http';
import { firstValueFrom, lastValueFrom } from 'rxjs';
import { filter, map, tap } from 'rxjs/operators';
import { API_CLIENT_CONFIG } from './api-config.js';

export type AssetKind = 'IMAGE' | 'SPRITE' | 'COVER' | 'OTHER';

export interface AssetView {
  id: string;
  kind: AssetKind;
  url: string;
  mimeType: string;
  sizeBytes: number;
  confirmed: boolean;
  uploadedById: string | null;
  createdAt: string;
}

export interface PresignedUpload {
  assetId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  url: string;
  expiresAt: string;
}

export interface AssetPage {
  items: AssetView[];
  nextCursor: string | null;
}

/**
 * Media uploads (docs/14 §3): presign → PUT the file → confirm. `upload()`
 * runs all three. Errors: 400 `ASSET_TYPE_NOT_ALLOWED` (incl. SVG),
 * 413 `ASSET_TOO_LARGE`, 400 `ASSET_CONTENT_MISMATCH` on confirm.
 */
@Injectable({ providedIn: 'root' })
export class AssetsClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);
  private get base() {
    return this.config.baseUrl;
  }

  presign(file: {
    kind: AssetKind;
    mimeType: string;
    sizeBytes: number;
    filename: string;
  }): Promise<PresignedUpload> {
    return firstValueFrom(
      this.http.post<PresignedUpload>(`${this.base}/assets/presign`, file),
    );
  }

  confirm(assetId: string): Promise<AssetView> {
    return firstValueFrom(
      this.http.post<AssetView>(
        `${this.base}/assets/${encodeURIComponent(assetId)}/confirm`,
        {},
      ),
    );
  }

  /** Presign, PUT with progress, confirm. Resolves with the confirmed asset. */
  async upload(
    file: File,
    kind: AssetKind,
    opts: { onProgress?: (fraction: number) => void } = {},
  ): Promise<AssetView> {
    const p = await this.presign({
      kind,
      mimeType: file.type,
      sizeBytes: file.size,
      filename: file.name,
    });
    const req = new HttpRequest('PUT', p.uploadUrl, file, {
      reportProgress: true,
      headers: undefined,
    });
    const withHeaders = req.clone({ setHeaders: p.headers });
    await lastValueFrom(
      this.http.request(withHeaders).pipe(
        tap((e) => {
          if (e.type === HttpEventType.UploadProgress && e.total)
            opts.onProgress?.(e.loaded / e.total);
        }),
        filter((e) => e.type === HttpEventType.Response),
        map(() => undefined),
      ),
    );
    opts.onProgress?.(1);
    return this.confirm(p.assetId);
  }

  list(
    opts: { kind?: AssetKind; cursor?: string; limit?: number } = {},
  ): Promise<AssetPage> {
    const params: Record<string, string> = {};
    if (opts.kind) params['kind'] = opts.kind;
    if (opts.cursor) params['cursor'] = opts.cursor;
    if (opts.limit) params['limit'] = String(opts.limit);
    return firstValueFrom(
      this.http.get<AssetPage>(`${this.base}/admin/assets`, { params }),
    );
  }

  remove(assetId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(
        `${this.base}/admin/assets/${encodeURIComponent(assetId)}`,
      ),
    );
  }
}
