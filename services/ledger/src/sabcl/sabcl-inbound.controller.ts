import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicRoute } from '../common/security/public.decorator';
import { LedgerSabclService } from './sabcl.service';

/**
 * SABCL ingress for the Ledger service.
 *
 * Marked `@PublicRoute()` so the internal-token guard does not run. That is not
 * a relaxation: the internal token proves only "something on the internal
 * network", while a SABCL envelope proves a specific named service signed this
 * specific message, bound to this route, within this time window, exactly once.
 * The envelope is the stronger credential, and requiring the token as well
 * would mean a router compromise plus a token leak could forge traffic that
 * looks authenticated.
 *
 * The existing internal routes keep their token guard untouched.
 */
@Controller('sabcl/v1')
export class LedgerSabclInboundController {
  constructor(private readonly sabcl: LedgerSabclService) {}

  @Post('inbound')
  @PublicRoute()
  async inbound(
    @Body() envelope: unknown,
    @Res() response: Response,
  ): Promise<void> {
    const outcome = await this.sabcl.handle(envelope);
    response
      .status(outcome.status)
      .type('application/sabcl-envelope+json')
      .send(outcome.body);
  }
}
