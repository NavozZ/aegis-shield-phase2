import { Body, Controller, Get, Post, Query, Req, HttpCode, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { ChannelOperationsService } from './channel-operations.service';

@Controller('internal/channel-operations')
export class ChannelOperationsController {
  constructor(private readonly channels: ChannelOperationsService) {}

  @Get('resolve-account')
  async resolveAccount(@Query('reference') reference: string) {
    return this.channels.resolveAccountByReference(reference);
  }

  @Post('qr-payment')
  @HttpCode(HttpStatus.OK)
  async qrPayment(@Body() body: any, @Req() request: Request) {
    const correlationId = request.headers['x-correlation-id'] as string || crypto.randomUUID();
    return this.channels.qrPayment(body, correlationId);
  }

  @Post('agent-cash-in')
  @HttpCode(HttpStatus.OK)
  async agentCashIn(@Body() body: any, @Req() request: Request) {
    const correlationId = request.headers['x-correlation-id'] as string || crypto.randomUUID();
    return this.channels.agentCashIn(body, correlationId);
  }

  @Post('agent-cash-out')
  @HttpCode(HttpStatus.OK)
  async agentCashOut(@Body() body: any, @Req() request: Request) {
    const correlationId = request.headers['x-correlation-id'] as string || crypto.randomUUID();
    return this.channels.agentCashOut(body, correlationId);
  }
}
