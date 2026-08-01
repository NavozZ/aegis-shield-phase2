import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicRoute } from '../common/security/public.decorator';
import { PaymentsSabclService } from './sabcl.service';

/**
 * SABCL ingress for the Payments service.
 *
 * `@PublicRoute()` exempts this from the internal-token guard because the
 * envelope's Ed25519 signature is a strictly stronger credential: it names the
 * sending service, binds the message to one route and one recipient, and is
 * valid exactly once inside a short window. See the equivalent controller in
 * the Ledger service for the full reasoning.
 */
@Controller('sabcl/v1')
export class PaymentsSabclInboundController {
  constructor(private readonly sabcl: PaymentsSabclService) {}

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
