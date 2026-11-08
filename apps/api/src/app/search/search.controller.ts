import { Controller, Get, Headers, Query } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { SearchService, type CatalogSearchResponse } from './search.service.js';

export class CatalogSearchQueryDto {
  @IsString()
  @Length(1, 80)
  q!: string;
}

/** `GET /catalog/search?q=` — header search for courses + lessons (any signed-in user). */
@Controller('catalog')
export class SearchController {
  constructor(private readonly svc: SearchService) {}

  @Get('search')
  search(
    @Query() query: CatalogSearchQueryDto,
    @Headers('accept-language') acceptLanguage?: string,
  ): Promise<CatalogSearchResponse> {
    const locale = acceptLanguage?.split(',')[0]?.trim() || 'pt-BR';
    return this.svc.search(query.q, locale);
  }
}
