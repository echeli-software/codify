import { InjectionToken } from '@angular/core';
import type { Observable } from 'rxjs';

/** Progress / completion events emitted by an uploader. */
export type UploadEvent<R = unknown> =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'done'; result: R };

/**
 * Pluggable upload backend for `cdf-file-uploader`. The admin app provides
 * one (presigned PUT to storage + `POST /api/assets/confirm`); stories and
 * tests provide fakes. Emitting `progress` events is optional.
 */
export interface FileUploaderBackend<R = unknown> {
  upload(file: File): Observable<UploadEvent<R>>;
}

export const FILE_UPLOADER = new InjectionToken<FileUploaderBackend>(
  'FILE_UPLOADER',
);
