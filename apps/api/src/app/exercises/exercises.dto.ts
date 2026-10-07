import {
  Allow,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ENTRY_FUNCTION_PATTERN, EXERCISE_LANGUAGES } from '@codify/domain';

/** A test case — fields pass the whitelist via @Allow (values are free-form JSON; checked in the service). */
export class TestCaseDto {
  @Allow() id?: string;
  @Allow() name?: string;
  @Allow() args?: unknown[];
  @Allow() expected?: unknown;
}

const ENTRY_MESSAGE =
  'entryFunction must be a plain identifier (letters, digits, underscore)';

export class CreateExerciseDto {
  @IsIn(EXERCISE_LANGUAGES)
  language!: (typeof EXERCISE_LANGUAGES)[number];

  @IsString()
  @Matches(ENTRY_FUNCTION_PATTERN, { message: ENTRY_MESSAGE })
  entryFunction!: string;

  @IsString()
  @Length(0, 20000)
  starterCode!: string;

  @IsString()
  @Length(1, 20000)
  solutionCode!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestCaseDto)
  visibleTests!: TestCaseDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestCaseDto)
  hiddenTests!: TestCaseDto[];

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(10000)
  timeLimitMs?: number;

  @IsOptional()
  @IsInt()
  @Min(16000)
  @Max(512000)
  memoryLimitKb?: number;

  /**
   * Optional custom harness appended after the student's code. It reads
   * `{ nonce, tests: [{ id, args }] }` from stdin and prints one
   * `<nonce>{"id", "passed"?, "actual"?, "error"?}` line per test.
   */
  @IsOptional()
  @IsString()
  @Length(0, 20000)
  testHarness?: string;
}

export class UpdateExerciseDto {
  @IsOptional()
  @IsIn(EXERCISE_LANGUAGES)
  language?: (typeof EXERCISE_LANGUAGES)[number];
  @IsOptional()
  @IsString()
  @Matches(ENTRY_FUNCTION_PATTERN, { message: ENTRY_MESSAGE })
  entryFunction?: string;
  @IsOptional() @IsString() @Length(0, 20000) starterCode?: string;
  @IsOptional() @IsString() @Length(1, 20000) solutionCode?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestCaseDto)
  visibleTests?: TestCaseDto[];
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestCaseDto)
  hiddenTests?: TestCaseDto[];
  @IsOptional() @IsInt() @Min(100) @Max(10000) timeLimitMs?: number;
  @IsOptional() @IsInt() @Min(16000) @Max(512000) memoryLimitKb?: number;
  @IsOptional() @IsString() @Length(0, 20000) testHarness?: string;
}

export class CodeDto {
  @IsString()
  @Length(0, 50000)
  code!: string;
}
