import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { QrService } from './qr.service';

@Controller('internal')
export class QrController {
  constructor(private readonly qrService: QrService) {}

  @Post('qr/issue')
  @HttpCode(HttpStatus.CREATED)
  async issue(
    @Body()
    body: {
      customerId: string;
      accountId: string;
      type: 'STATIC' | 'DYNAMIC';
      amountMinor?: string;
      currency: string;
      purpose?: string;
    },
  ) {
    return this.qrService.issue(body);
  }

  @Post('qr/preview')
  @HttpCode(HttpStatus.OK)
  async preview(
    @Body()
    body: {
      payload: string;
      senderCustomerId: string;
      sourceAccountId: string;
    },
  ) {
    return this.qrService.preview(body);
  }

  @Post('qr/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @Body()
    body: {
      senderCustomerId: string;
      intentToken: string;
      idempotencyKey: string;
      amountMinor?: string;
    },
    @Req() request: Request,
  ) {
    const correlationId =
      (request.headers['x-correlation-id'] as string) || crypto.randomUUID();
    return this.qrService.confirm(body, correlationId);
  }

  @Get('qr/:customerId/:qrId/status')
  async status(
    @Param('customerId') customerId: string,
    @Param('qrId') qrId: string,
  ) {
    return this.qrService.status(customerId, qrId);
  }

  @Get('qr/:customerId/:qrId/receipt')
  async receipt(
    @Param('customerId') customerId: string,
    @Param('qrId') qrId: string,
  ) {
    return this.qrService.receipt(customerId, qrId);
  }
}
