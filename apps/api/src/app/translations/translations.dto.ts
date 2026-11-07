import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
