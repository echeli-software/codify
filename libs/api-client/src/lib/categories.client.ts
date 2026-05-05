import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconName: string | null;
  colorToken: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryListResponse {
  items: Category[];
  total: number;
}

export interface CreateCategoryBody {
  slug: string;
  name: string;
  description?: string;
  iconName?: string;
  colorToken?: string;
}

export type UpdateCategoryBody = Partial<CreateCategoryBody>;

/**
 * Typed client for /api/categories. POST + PATCH ride the idempotency
 * interceptor so a flaky network can't double-create a category. List +
 * detail are public-cached on the server later (Phase 5e); for now they
 * just hit the DB directly.
 */
@Injectable({ providedIn: 'root' })
export class CategoriesClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  list(opts: { skip?: number; take?: number } = {}): Promise<CategoryListResponse> {
    let params = new HttpParams();
    if (typeof opts.skip === 'number') params = params.set('skip', String(opts.skip));
    if (typeof opts.take === 'number') params = params.set('take', String(opts.take));
    return firstValueFrom(
      this.http.get<CategoryListResponse>(`${this.config.baseUrl}/categories`, {
        params,
      }),
    );
  }

  detail(id: string): Promise<Category> {
    return firstValueFrom(
      this.http.get<Category>(
        `${this.config.baseUrl}/categories/${encodeURIComponent(id)}`,
      ),
    );
  }

  create(body: CreateCategoryBody): Promise<Category> {
    return firstValueFrom(
      this.http.post<Category>(`${this.config.baseUrl}/categories`, body, {
        context: withIdempotency(),
      }),
    );
  }

  update(id: string, body: UpdateCategoryBody): Promise<Category> {
    return firstValueFrom(
      this.http.patch<Category>(
        `${this.config.baseUrl}/categories/${encodeURIComponent(id)}`,
        body,
        { context: withIdempotency() },
      ),
    );
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(
        `${this.config.baseUrl}/categories/${encodeURIComponent(id)}`,
      ),
    );
  }
}
