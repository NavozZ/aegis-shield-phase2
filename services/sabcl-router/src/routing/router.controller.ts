import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RouterService } from './router.service';

/**
 * The router's only ingress.
 *
 * There is exactly one path and one method. The router exposes no way to name a
 * destination, a header or a query, so there is no shape of request that turns
 * it into a general proxy.
 */
@Controller('sabcl/v1')
export class RouterController {
  constructor(private readonly router: RouterService) {}

  @Post('messages')
  async accept(
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    // Byte length is taken from the raw body the size limiter already bounded,
    // so an oversized envelope is rejected without re-serialising it.
    const declared = Number(request.header('content-length') ?? 0);
    const byteLength = Number.isSafeInteger(declared)
      ? declared
      : Number.MAX_SAFE_INTEGER;
    const outcome = await this.router.route(body, byteLength);
    response
      .status(outcome.status)
      .type('application/sabcl-envelope+json')
      .send(outcome.body);
  }
}
