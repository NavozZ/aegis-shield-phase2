import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicRoute } from '../common/security/public.decorator';
import { IdentitySabclService } from './sabcl.service';

/**
 * SABCL ingress for the Identity service.
 *
 * `@PublicRoute()` exempts this from the internal-token guard; the envelope
 * signature is the credential. See the Ledger equivalent for the reasoning.
 */
@Controller('sabcl/v1')
export class IdentitySabclInboundController {
  constructor(private readonly sabcl: IdentitySabclService) {}

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
