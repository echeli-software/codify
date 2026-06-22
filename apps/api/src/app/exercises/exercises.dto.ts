import { Allow, IsArray, IsInt, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** A test case — fields pass the whitelist via @Allow (values are free-form JSON). */
export class TestCaseDto {
  @Allow() id?: string;
  @Allow() name?: string;
  @Allow() args?: unknown[];
  @Allow() expected?: unknown;
}

export class CreateExerciseDto {
  @IsString() @Length(1, 40)
  language!: string;

  @IsString() @Length(1, 80)
  entryFunction!: string;

  @IsString() @Length(0, 20000)
  starterCode!: string;

  @IsString() @Length(1, 20000)
  solutionCode!: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => TestCaseDto)
  visibleTests!: TestCaseDto[];

  @IsArray() @ValidateNested({ each: true }) @Type(() => TestCaseDto)
  hiddenTests!: TestCaseDto[];

  @IsOptional() @IsInt() @Min(100) @Max(10000)
  timeLimitMs?: number;

  @IsOptional() @IsInt() @Min(1000) @Max(512000)
  memoryLimitKb?: number;

  @IsOptional() @IsString() @Length(0, 20000)
  testHarness?: string;
}

export class UpdateExerciseDto {
  @IsOptional() @IsString() @Length(1, 40) language?: string;
  @IsOptional() @IsString() @Length(1, 80) entryFunction?: string;
  @IsOptional() @IsString() @Length(0, 20000) starterCode?: string;
  @IsOptional() @IsString() @Length(1, 20000) solutionCode?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TestCaseDto) visibleTests?: TestCaseDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TestCaseDto) hiddenTests?: TestCaseDto[];
  @IsOptional() @IsInt() @Min(100) @Max(10000) timeLimitMs?: number;
  @IsOptional() @IsInt() @Min(1000) @Max(512000) memoryLimitKb?: number;
  @IsOptional() @IsString() @Length(0, 20000) testHarness?: string;
}

export class CodeDto {
  @IsString() @Length(0, 50000)
  code!: string;
}
