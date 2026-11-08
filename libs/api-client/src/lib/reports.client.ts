import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CLIENT_CONFIG } from './api-config.js';

export interface RetentionCohort {
  cohortStart: string;
  size: number;
  /** Share (0–1) of the measurable members active on day N; null when none is measurable yet. */
  d1: number | null;
  d7: number | null;
  d30: number | null;
  eligible: { d1: number; d7: number; d30: number };
}

export interface LeagueWeekReport {
  weekStart: string;
  members: number;
  activeMembers: number;
  activeStudents: number;
  participation: number | null;
  promoted: number;
  demoted: number;
}

export interface ShopWeekReport {
  weekStart: string;
  coinsSpent: number;
  purchases: number;
  buyers: number;
}

export interface BillingReport {
  mrr: {
    currency: 'BRL';
    amountCents: number;
    byPlan: {
      planId: string;
      planName: string;
      amountCents: number;
      subscriptions: number;
      excluded: number;
    }[];
  };
  weeks: {
    weekStart: string;
    newPaid: number;
    churned: number;
    netNew: number;
  }[];
  trialToPaid: { trialsEnded: number; converted: number; rate: number | null };
  arppu: {
    currency: string;
    revenueCents: number;
    payingUsers: number;
    arppuCents: number;
  }[];
  refunds: {
    currency: string;
    paidCents: number;
    refundedCents: number;
    payments: number;
    refundedPayments: number;
    rate: number | null;
  }[];
}

export interface OverviewReport {
  generatedAt: string;
  retention: RetentionCohort[];
  leagues: LeagueWeekReport[];
  shop: ShopWeekReport[];
  billing: BillingReport;
  /** Learners per country (docs/15 Phase 14); older APIs omit it. */
  countries?: CountryReport;
  /** BRL monthly "card only" checkout funnel, last 30 days. */
  monthlyPix?: MonthlyPixFunnel;
}

export interface CountryCounts {
  /** ISO 3166-1 alpha-2; null for the Other / Unknown rows and totals. */
  country: string | null;
  learners: number;
  active7: number;
  active30: number;
  paid: number;
}

export interface CountryReportRow extends CountryCounts {
  kind: 'country' | 'other' | 'unknown';
  /** Countries folded into the Other row. */
  countries: number;
}

/** Top 10 countries by learners, then Other, then Unknown. */
export interface CountryReport {
  rows: CountryReportRow[];
  total: CountryCounts;
}

/** Subscription-page visits that met "card only" on a BRL monthly price. */
export interface MonthlyPixFunnel {
  days: number;
  cardOnlySeen: number;
  cardCheckout: number;
  switchedAnnual: number;
  /** Switched to annual and paid with PIX or Boleto. */
  switchedAnnualPrepay: number;
  left: number;
}

export interface CourseFunnel {
  courseId: string;
  slug: string;
  title: string;
  status: string;
  lessons: number;
  enrolled: number;
  started: number;
  completed: number;
}

export interface LessonFunnel {
  lessonId: string;
  title: string;
  position: number;
  type: string;
  opened: number;
  completed: number;
  dropOff: number;
  dropOffRate: number | null;
}

/** Admin analytics reports (`/api/admin/reports`). */
@Injectable({ providedIn: 'root' })
export class ReportsClient {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CLIENT_CONFIG);

  /** ADMIN. Cached 10 min server-side unless `fresh`. */
  overview(fresh = false): Promise<OverviewReport> {
    return firstValueFrom(
      this.http.get<OverviewReport>(
        `${this.config.baseUrl}/admin/reports/overview`,
        { params: fresh ? { fresh: '1' } : {} },
      ),
    );
  }

  /** ADMIN every course, TEACHER own courses. */
  courses(): Promise<{ items: CourseFunnel[] }> {
    return firstValueFrom(
      this.http.get<{ items: CourseFunnel[] }>(
        `${this.config.baseUrl}/admin/reports/courses`,
      ),
    );
  }

  course(
    courseId: string,
  ): Promise<{ course: CourseFunnel; lessons: LessonFunnel[] }> {
    return firstValueFrom(
      this.http.get<{ course: CourseFunnel; lessons: LessonFunnel[] }>(
        `${this.config.baseUrl}/admin/reports/courses/${encodeURIComponent(courseId)}`,
      ),
    );
  }
}
