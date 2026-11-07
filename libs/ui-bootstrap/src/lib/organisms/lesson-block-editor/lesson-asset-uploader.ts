import { InjectionToken } from '@angular/core';

export interface LessonAssetUploadOptions {
  /** Called with 0..1 as bytes go out (optional; omit → indeterminate UI). */
  onProgress?: (fraction: number) => void;
  /** Aborted when the author cancels the upload. */
  signal?: AbortSignal;
}

export interface LessonAssetUploadResult {
  /** Public URL the image renders from (http(s) or same-origin path). */
  url: string;
  /** Media-library Asset id stored on the image block. */
  assetId: string;
}

/**
 * Uploads an image for the lesson editor. The admin app provides it, backed
 * by the assets API (presign → PUT → confirm):
 *
 *   providers: [{ provide: LESSON_ASSET_UPLOADER, useClass: AssetsLessonUploader }]
 *
 * Without a provider the editor still accepts image URLs.
 */
export interface LessonAssetUploader {
  upload(
    file: File,
    options?: LessonAssetUploadOptions,
  ): Promise<LessonAssetUploadResult>;
}

export const LESSON_ASSET_UPLOADER = new InjectionToken<LessonAssetUploader>(
  'LESSON_ASSET_UPLOADER',
);

/** Image types the editor accepts for upload (docs/06 §10). */
export const LESSON_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
] as const;

/** Client-side cap; the API enforces its own limit. */
export const LESSON_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
