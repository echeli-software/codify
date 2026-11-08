import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';

export const BULK_COURSE_ACTIONS = [
  'publish',
  'archive',
  'setCategories',
] as const;
export type BulkCourseAction = (typeof BULK_COURSE_ACTIONS)[number];

/** POST /api/courses/bulk */
export class BulkCoursesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Length(1, 64, { each: true })
  ids!: string[];

  @IsIn(BULK_COURSE_ACTIONS)
  action!: BulkCourseAction;

  /** `setCategories`: the categories every selected course ends up with. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  categoryIds?: string[];
}

export interface BulkCoursesResponse {
  action: BulkCourseAction;
  updated: string[];
  failed: { id: string; status: number; message: string }[];
}

export class CurriculumModuleOrderDto {
  @IsString()
  @Length(1, 64)
  id!: string;

  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  lessonIds!: string[];
}

/** PUT /api/courses/:id/curriculum/order — the whole tree, in order. */
export class CurriculumOrderDto {
  @ValidateNested({ each: true })
  @Type(() => CurriculumModuleOrderDto)
  @IsArray()
  @ArrayMaxSize(200)
  modules!: CurriculumModuleOrderDto[];
}

/** PUT /api/courses/:id/free-lessons */
export class FreeLessonsDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  lessonIds!: string[];
}

export interface CourseAuthorView {
  id: string;
  displayName: string;
  courseCount: number;
}
