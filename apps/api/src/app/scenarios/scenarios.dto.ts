import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class ScenarioGraphDto {
  /** Free-form scenario graph { startId, nodes } — validated by the domain layer. */
  @IsObject()
  graph!: Record<string, unknown>;
}

export class CompleteScenarioDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  path!: string[];

  /** Offline play time (docs/16 §7) — ISO-8601; validated by the service. */
  @IsOptional()
  @IsString()
  @Length(1, 40)
  clientTimestamp?: string;
}
