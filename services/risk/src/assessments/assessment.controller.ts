import { riskEvaluationRequestSchema } from '@aegis/contracts';
import { Body, Controller, Post } from '@nestjs/common';
import { AssessmentService } from './assessment.service';
@Controller('internal/v1/assessments')
export class AssessmentController {
  constructor(private readonly assessments: AssessmentService) {}
  @Post('evaluate') evaluate(@Body() body: unknown) {
    return this.assessments.evaluate(riskEvaluationRequestSchema.parse(body));
  }
}
