import { ArrayMaxSize, IsArray, IsObject, IsString, Length } from 'class-validator';

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
}
