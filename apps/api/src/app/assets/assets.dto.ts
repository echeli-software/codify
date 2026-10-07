import { IsIn, IsInt, IsString, Length, Max, Min } from 'class-validator';

export const ASSET_KINDS = ['IMAGE', 'SPRITE', 'COVER', 'OTHER'] as const;

/** POST /api/assets/presign */
export class PresignAssetDto {
  @IsIn(ASSET_KINDS)
  kind!: (typeof ASSET_KINDS)[number];

  @IsString()
  @Length(3, 100)
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(50 * 1024 * 1024)
  sizeBytes!: number;

  /** Original file name, for the media library label only. */
  @IsString()
  @Length(1, 200)
  filename!: string;
}

export interface PresignAssetResponse {
  assetId: string;
  /** PUT the raw file here with `headers`. */
  uploadUrl: string;
  headers: Record<string, string>;
  /** Where the file will be served once confirmed. */
  url: string;
  expiresAt: string;
}

export interface AssetView {
  id: string;
  kind: (typeof ASSET_KINDS)[number];
  url: string;
  mimeType: string;
  sizeBytes: number;
  confirmed: boolean;
  uploadedById: string | null;
  createdAt: string;
}
