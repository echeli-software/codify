import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  Max,
  Min,
  IsString,
  Length,
  Matches,
} from 'class-validator';

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** POST /api/categories body. */
export class CreateCategoryDto {
  @IsString()
  @Length(2, 40)
  @Matches(SLUG_PATTERN, {
    message: 'slug must be kebab-case (a-z, 0-9, hyphen), 2-40 chars',
  })
  slug!: string;

  @IsString()
  @Length(1, 80)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  iconName?: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  colorToken?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;
}

/** PATCH /api/categories/:id body. */
export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @Length(2, 40)
  @Matches(SLUG_PATTERN, {
    message: 'slug must be kebab-case (a-z, 0-9, hyphen), 2-40 chars',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  iconName?: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  colorToken?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;
}

export interface CategoryResponse {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconName: string | null;
  colorToken: string | null;
  /** Catalog order (ascending). */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryListResponse {
  items: CategoryResponse[];
  total: number;
}

/** PUT /api/categories/order — every live category id, in the new order. */
export class ReorderCategoriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids!: string[];
}
