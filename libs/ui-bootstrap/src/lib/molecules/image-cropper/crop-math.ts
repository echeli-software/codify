/** Pure geometry for `cdf-image-cropper` (unit-tested, no DOM). */

export interface CropState {
  /** Natural image size in px. */
  naturalWidth: number;
  naturalHeight: number;
  /** Viewport (crop window) size in CSS px. */
  viewportWidth: number;
  viewportHeight: number;
  /** CSS px per natural px. */
  scale: number;
  /** Image top-left relative to the viewport, CSS px (≤ 0). */
  offsetX: number;
  offsetY: number;
}

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Smallest scale at which the image still covers the whole viewport. */
export function minCoverScale(
  s: Pick<
    CropState,
    'naturalWidth' | 'naturalHeight' | 'viewportWidth' | 'viewportHeight'
  >,
): number {
  if (s.naturalWidth <= 0 || s.naturalHeight <= 0) return 1;
  return Math.max(
    s.viewportWidth / s.naturalWidth,
    s.viewportHeight / s.naturalHeight,
  );
}

/** Keep the image covering the viewport (no empty gutters). */
export function clampOffsets(s: CropState): CropState {
  const w = s.naturalWidth * s.scale;
  const h = s.naturalHeight * s.scale;
  const clamp = (v: number, min: number) => Math.min(0, Math.max(min, v));
  return {
    ...s,
    offsetX: clamp(s.offsetX, s.viewportWidth - w),
    offsetY: clamp(s.offsetY, s.viewportHeight - h),
  };
}

/**
 * Zoom around the viewport centre, clamped to [minCoverScale, maxScale].
 */
export function zoomTo(
  s: CropState,
  nextScale: number,
  maxScale = 8,
): CropState {
  const min = minCoverScale(s);
  const scale = Math.min(Math.max(nextScale, min), Math.max(min, maxScale));
  const cx = s.viewportWidth / 2;
  const cy = s.viewportHeight / 2;
  // Natural-pixel point currently under the centre stays under it.
  const px = (cx - s.offsetX) / s.scale;
  const py = (cy - s.offsetY) / s.scale;
  return clampOffsets({
    ...s,
    scale,
    offsetX: cx - px * scale,
    offsetY: cy - py * scale,
  });
}

/** Initial state: cover + centre. */
export function initialCrop(
  naturalWidth: number,
  naturalHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): CropState {
  const base = { naturalWidth, naturalHeight, viewportWidth, viewportHeight };
  const scale = minCoverScale(base);
  return {
    ...base,
    scale,
    offsetX: (viewportWidth - naturalWidth * scale) / 2,
    offsetY: (viewportHeight - naturalHeight * scale) / 2,
  };
}

/** The source rectangle (natural px) visible in the viewport. */
export function cropRect(s: CropState): CropRect {
  const sw = s.viewportWidth / s.scale;
  const sh = s.viewportHeight / s.scale;
  const sx = Math.max(0, Math.min(s.naturalWidth - sw, -s.offsetX / s.scale));
  const sy = Math.max(0, Math.min(s.naturalHeight - sh, -s.offsetY / s.scale));
  return { sx, sy, sw, sh };
}
