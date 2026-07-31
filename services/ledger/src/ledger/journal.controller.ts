import {
  internalJournalRequestSchema,
  type JournalResult,
} from '@aegis/contracts';
import { Body, Controller, Post, Req } from '@nestjs/common';
import { parseInput } from '../common/http/zod';
import type { RequestContext } from '../common/http/request-context';
import { JournalService } from './journal.service';

/**
 * Journal posting is a trusted, service-to-service operation. It is deliberately
 * not reachable from a customer browser: the API Gateway exposes no route that
 * forwards to it.
 */
@Controller('internal')
export class JournalController {
  constructor(private readonly journals: JournalService) {}

  @Post('journal-entries')
  post(
    @Body() body: unknown,
    @Req() request: RequestContext,
  ): Promise<JournalResult> {
    return this.journals.post(
      parseInput(internalJournalRequestSchema, body),
      request.correlationId,
      { type: 'SERVICE', id: 'internal' },
    );
  }
}
