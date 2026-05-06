import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';
import { withIdempotency } from './idempotency.js';

export interface CourseModule {
  id: string;
  courseId: string;
  order: number;
  title: string;
  lessonCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateModuleBody {
  title: string;
  order?: number;
}

export type UpdateModuleBody = Partial<CreateModuleBody>;

@Injectable({ providedIn: 'root' })
export class ModulesClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  listForCourse(courseId: string): Promise<CourseModule[]> {
    return firstValueFrom(
      this.http.get<CourseModule[]>(
        `${this.config.baseUrl}/courses/${encodeURIComponent(courseId)}/modules`,
      ),
    );
  }

  create(courseId: string, body: CreateModuleBody): Promise<CourseModule> {
    return firstValueFrom(
      this.http.post<CourseModule>(
        `${this.config.baseUrl}/courses/${encodeURIComponent(courseId)}/modules`,
        body,
        { context: withIdempotency() },
      ),
    );
  }

  update(id: string, body: UpdateModuleBody): Promise<CourseModule> {
    return firstValueFrom(
      this.http.patch<CourseModule>(
        `${this.config.baseUrl}/modules/${encodeURIComponent(id)}`,
        body,
        { context: withIdempotency() },
      ),
    );
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(
        `${this.config.baseUrl}/modules/${encodeURIComponent(id)}`,
      ),
    );
  }
}
