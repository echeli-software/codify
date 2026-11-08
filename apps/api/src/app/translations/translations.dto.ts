import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  SUPPORTED_LOCALES,
  TRANSLATABLE_ENTITIES,
} from './translations.logic.js';

export class ListTranslationsQueryDto {
  @IsOptional()
  @IsIn(TRANSLATABLE_ENTITIES)
  entityType?: (typeof TRANSLATABLE_ENTITIES)[number];

  @IsOptional()
  @IsIn(SUPPORTED_LOCALES)
  locale?: (typeof SUPPORTED_LOCALES)[number];

  @IsOptional()
  @IsIn(['missing', 'outdated', 'done'])
  status?: 'missing' | 'outdated' | 'done';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class TranslationUpsertDto {
  @IsIn(TRANSLATABLE_ENTITIES)
  entityType!: (typeof TRANSLATABLE_ENTITIES)[number];

  @IsString()
  @Length(1, 64)
  entityId!: string;

  @IsString()
  @Length(1, 40)
  field!: string;

  @IsIn(SUPPORTED_LOCALES)
  locale!: (typeof SUPPORTED_LOCALES)[number];

  /** Translated text (JSON-encoded for `contentJson`). */
  @IsString()
  @MaxLength(600_000)
  value!: string;
}

export class UpsertTranslationsDto {
  @ValidateNested({ each: true })
  @Type(() => TranslationUpsertDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  items!: TranslationUpsertDto[];
}

export class ResolveTranslationsQueryDto {
  @IsIn(TRANSLATABLE_ENTITIES)
  entityType!: (typeof TRANSLATABLE_ENTITIES)[number];

  /** Comma-separated entity ids (≤ 100). */
  @IsString()
  @MaxLength(100 * 40)
  ids!: string;

  @IsIn(SUPPORTED_LOCALES)
  locale!: (typeof SUPPORTED_LOCALES)[number];

  /** Comma-separated field names; defaults to every public field. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fields?: string;
}

export class TranslationRefDto {
  @IsIn(TRANSLATABLE_ENTITIES)
  entityType!: (typeof TRANSLATABLE_ENTITIES)[number];

  @IsString()
  @Length(1, 64)
  entityId!: string;

  @IsString()
  @Length(1, 40)
  field!: string;

  @IsIn(SUPPORTED_LOCALES)
  locale!: (typeof SUPPORTED_LOCALES)[number];
}

/** POST /api/admin/translations/complete */
export class MarkTranslationsCompleteDto {
  @ValidateNested({ each: true })
  @Type(() => TranslationRefDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  items!: TranslationRefDto[];
}

/** GET /api/admin/translations/export */
export class ExportTranslationsQueryDto {
  @IsIn(TRANSLATABLE_ENTITIES)
  entityType!: (typeof TRANSLATABLE_ENTITIES)[number];

  @IsIn(SUPPORTED_LOCALES)
  locale!: (typeof SUPPORTED_LOCALES)[number];

  @IsOptional()
  @IsIn(['csv', 'json'])
  format?: 'csv' | 'json';
}

/** POST /api/admin/translations/import */
export class ImportTranslationsDto {
  @IsIn(TRANSLATABLE_ENTITIES)
  entityType!: (typeof TRANSLATABLE_ENTITIES)[number];

  @IsIn(SUPPORTED_LOCALES)
  locale!: (typeof SUPPORTED_LOCALES)[number];

  @IsIn(['csv', 'json'])
  format!: 'csv' | 'json';

  /** The file's text (UTF-8). The JSON body limit (1 MB) bounds it. */
  @IsString()
  @Length(1, 1_000_000)
  content!: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
