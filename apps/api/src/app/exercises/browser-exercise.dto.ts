import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class BrowserTestOutcomeDto {
  @IsString()
  @Length(1, 80)
  id!: string;

  @IsBoolean()
  passed!: boolean;

  /** Short failure text shown back to the student (optional). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  error?: string;
}

/** `POST /exercises/:id/browser-result` (docs/12 §4 browser-side). */
export class BrowserResultDto {
  @IsString()
  @MaxLength(100_000)
  code!: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BrowserTestOutcomeDto)
  results!: BrowserTestOutcomeDto[];

  /** Device time of the run (streak attribution); ISO-8601. */
  @IsOptional()
  @IsString()
  @Length(1, 40)
  clientTimestamp?: string;
}
