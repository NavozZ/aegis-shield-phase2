import type { ReconciliationResult } from '@aegis/contracts';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { LedgerError } from '../common/errors/ledger.error';
import type { RequestContext } from '../common/http/request-context';
import { ReconciliationService } from './reconciliation.service';

@Controller('internal/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  run(@Req() request: RequestContext): Promise<ReconciliationResult> {
    return this.reconciliation.run(request.correlationId);
  }

  @Get('latest')
  async latest(): Promise<ReconciliationResult> {
    const latest = await this.reconciliation.latest();
    if (!latest) {
      throw new LedgerError(
        'NOT_FOUND',
        'No reconciliation run has been recorded.',
        HttpStatus.NOT_FOUND,
      );
    }
    return latest;
  }
}
