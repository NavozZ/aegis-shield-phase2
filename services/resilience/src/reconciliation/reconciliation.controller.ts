import { Controller, Post } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';

@Controller('internal/v1')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Post('reconciliation')
  async reconcile() {
    return this.reconciliation.reconcile();
  }
}
