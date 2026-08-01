import {
  internalLedgerTransferCommandSchema,
  internalTransferPreviewSchema,
  type InternalLedgerTransferResult,
  type InternalTransferPreviewResult,
} from '@aegis/contracts';
import { Body, Controller, Post, Req } from '@nestjs/common';
import { parseInput } from '../common/http/zod';
import type { RequestContext } from '../common/http/request-context';
import { CustomerTransferService } from './customer-transfer.service';
@Controller('internal/customer-transfers')
export class CustomerTransferController {
  constructor(private readonly transfers: CustomerTransferService) {}
  @Post('preview') preview(
    @Body() body: unknown,
  ): Promise<InternalTransferPreviewResult> {
    return this.transfers.preview(
      parseInput(internalTransferPreviewSchema, body),
    );
  }
  @Post() transfer(
    @Body() body: unknown,
    @Req() request: RequestContext,
  ): Promise<InternalLedgerTransferResult> {
    return this.transfers.transfer(
      parseInput(internalLedgerTransferCommandSchema, body),
      request.correlationId,
    );
  }
}
