import { Controller, Post } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
@Controller('internal/v1/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}
  @Post() run() {
    return this.reconciliation.run();
  }
}
