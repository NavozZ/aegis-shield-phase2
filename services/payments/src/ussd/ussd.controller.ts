import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { UssdService } from './ussd.service';

@Controller('internal/ussd')
export class UssdController {
  constructor(private readonly ussd: UssdService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Body()
    body: { sessionId: string; msisdn: string; input: string; type?: string },
    @Req() request: Request,
  ) {
    const correlationId =
      (request.headers['x-correlation-id'] as string) || crypto.randomUUID();
    return this.ussd.handleWebhook(body, correlationId);
  }

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  async simulate(
    @Body()
    body: { sessionId: string; msisdn: string; input: string; type?: string },
    @Req() request: Request,
  ) {
    const correlationId =
      (request.headers['x-correlation-id'] as string) || crypto.randomUUID();
    const customerId = request.headers['x-aegis-customer-id'] as string;
    return this.ussd.handleSimulate(body, customerId, correlationId);
  }
}
