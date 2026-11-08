import { Module } from '@nestjs/common';
import { CourseAdminController } from './course-admin.controller.js';
import { CourseInsightsService } from './course-insights.service.js';
import { CoursesController } from './courses.controller.js';
import { CoursesService } from './courses.service.js';
import { CurriculumService } from './curriculum.service.js';

@Module({
  controllers: [CourseAdminController, CoursesController],
  providers: [CoursesService, CurriculumService, CourseInsightsService],
  exports: [CoursesService],
})
export class CoursesModule {}
