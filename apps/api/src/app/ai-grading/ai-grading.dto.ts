import { Allow, IsArray, IsInt, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** A rubric criterion — `config` is free-form JSON kept via @Allow. */
export class RubricCriterionDto {
  @IsString() @Length(1, 80) id!: string;
  @IsString() @Length(1, 200) label!: string;
  @IsInt() @Min(0) @Max(100) weight!: number;
  @IsString() @Length(1, 20) kind!: string;
  @Allow() config?: Record<string, unknown>;
}

export class CreateAiPromptDto {
  @IsString() @Length(1, 8000)
  promptText!: string;

  @IsOptional() @IsString() @Length(0, 8000)
  contextText?: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => RubricCriterionDto)
  rubric!: RubricCriterionDto[];

  @IsOptional() @IsInt() @Min(0) @Max(100)
  passThreshold?: number;

  @IsOptional() @IsInt() @Min(0) @Max(50)
  maxAttempts?: number;
}

export class UpdateAiPromptDto {
  @IsOptional() @IsString() @Length(1, 8000) promptText?: string;
  @IsOptional() @IsString() @Length(0, 8000) contextText?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RubricCriterionDto) rubric?: RubricCriterionDto[];
  @IsOptional() @IsInt() @Min(0) @Max(100) passThreshold?: number;
  @IsOptional() @IsInt() @Min(0) @Max(50) maxAttempts?: number;
}

export class ResponseDto {
  @IsString() @Length(0, 20000)
  response!: string;
}
