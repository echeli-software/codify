import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

/**
 * Body for POST /api/courses/:courseId/modules. Title goes into a
 * source-locale ContentTranslation row inside the same transaction
 * as the Module row.
 */
export class CreateModuleDto {
  @IsString()
  @Length(1, 120)
  title!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class UpdateModuleDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export interface ModuleResponse {
  id: string;
  courseId: string;
  order: number;
  title: string;
  lessonCount: number;
  createdAt: string;
  updatedAt: string;
}
