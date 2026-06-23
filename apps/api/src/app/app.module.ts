import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AiGradingModule } from './ai-grading/ai-grading.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthMiddleware } from './auth/auth.middleware.js';
import { AuthModule } from './auth/auth.module.js';
import { BillingModule } from './billing/billing.module.js';
import { CategoriesModule } from './categories/categories.module.js';
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

@Module({
  imports: [
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
    CoursesModule,
    ExercisesModule,
    ModulesModule,
    LessonsModule,
    NotificationsModule,
    PlansModule,
    ProgressModule,
    ScenariosModule,
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
