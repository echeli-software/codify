import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';

export interface SearchCourseHit {
  id: string;
  slug: string;
  title: string;
}

export interface SearchLessonHit {
  id: string;
  title: string;
  type: string;
  isFree: boolean;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
}

/** `GET /catalog/search?q=` — student header search (courses + lessons). */
export interface CatalogSearchResponse {
  courses: SearchCourseHit[];
  lessons: SearchLessonHit[];
}

@Injectable({ providedIn: 'root' })
export class SearchClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  search(q: string): Promise<CatalogSearchResponse> {
    return firstValueFrom(
      this.http.get<CatalogSearchResponse>(
        `${this.config.baseUrl}/catalog/search`,
        { params: new HttpParams().set('q', q) },
      ),
    );
  }
}
