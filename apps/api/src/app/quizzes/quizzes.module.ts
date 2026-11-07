import { Module } from '@nestjs/common';
import { QuizzesController } from './quizzes.controller.js';
import { QuizzesService } from './quizzes.service.js';

/** Quiz grading. AccessService and ProgressService come from global modules. */
@Module({
  controllers: [QuizzesController],
  providers: [QuizzesService],
})
export class QuizzesModule {}
