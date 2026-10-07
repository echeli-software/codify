import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AiGradingModule } from './ai-grading/ai-grading.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthMiddleware } from './auth/auth.middleware.js';
import { AuthModule } from './auth/auth.module.js';
import { BillingModule } from './billing/billing.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { CertificatesModule } from './certificates/certificates.module.js';
import { CoursesModule } from './courses/courses.module.js';
import { ExercisesModule } from './exercises/exercises.module.js';
import { GamificationModule } from './gamification/gamification.module.js';
import { HealthModule } from './health/health.module.js';
import { ItemsModule } from './items/items.module.js';
import { LeaguesModule } from './leagues/leagues.module.js';
import { LessonsModule } from './lessons/lessons.module.js';
import { ModulesModule } from './modules/modules.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PlansModule } from './plans/plans.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProgressModule } from './progress/progress.module.js';
import { ScenariosModule } from './scenarios/scenarios.module.js';
import { UsersModule } from './users/users.module.js';
import { QuizzesModule } from './quizzes/quizzes.module.js';
import { EnrollmentsModule } from './enrollments/enrollments.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { AssetsModule } from './assets/assets.module.js';
import { ReferralsModule } from './referrals/referrals.module.js';
import { TranslationsModule } from './translations/translations.module.js';

import { AppConfigModule } from './config/config.module.js';
import { PlatformModule } from './common/platform.module.js';
import { OpsModule } from './ops/ops.module.js';

@Module({
  imports: [
    // Cron jobs (league rollover, streak reminders, quest assignment, drift
    // check) register with @Cron in their own services.
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    AuditModule,
    AiGradingModule,
    BillingModule,
    GamificationModule,
    HealthModule,
    ItemsModule,
    LeaguesModule,
    UsersModule,
    CategoriesModule,
    CertificatesModule,
    CoursesModule,
    ExercisesModule,
    ModulesModule,
    LessonsModule,
    NotificationsModule,
    PlansModule,
    ProgressModule,
    ScenariosModule,
    QuizzesModule,
    EnrollmentsModule,
    AnalyticsModule,
    AssetsModule,
    ReferralsModule,
    TranslationsModule,

    AppConfigModule,
    PlatformModule,
    OpsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // AuthMiddleware runs on every request, populating `req.user` when a
    // valid Bearer token is present. The RolesGuard (bound globally via
    // APP_GUARD) enforces `@Public()` / `@Roles(...)` rules.
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
