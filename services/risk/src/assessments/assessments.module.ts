import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { AssessmentController } from './assessment.controller';
import { AssessmentService } from './assessment.service';
@Module({
  imports: [EventsModule],
  controllers: [AssessmentController],
  providers: [AssessmentService],
  exports: [AssessmentService],
})
export class AssessmentsModule {}
