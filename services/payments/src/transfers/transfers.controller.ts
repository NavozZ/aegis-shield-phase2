import {
  internalTransferConfirmationSchema,
  internalTransferIntentRequestSchema,
  opaqueIntentTokenSchema,
  transferListQuerySchema,
} from '@aegis/contracts';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TransfersService } from './transfers.service';
import { PaymentsReconciliationService } from '../reconciliation/payments-reconciliation.service';
const uuid = z.uuid();
function parse<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  return schema.parse(value);
}
@Controller('internal')
export class TransfersController {
  constructor(
    private readonly transfers: TransfersService,
    private readonly reconciliation: PaymentsReconciliationService,
  ) {}
  private customer(value?: string) {
    return parse(uuid, value?.trim());
  }
  private correlation(request: { header(name: string): string | undefined }) {
    const value = request.header('x-correlation-id');
    return value && uuid.safeParse(value).success ? value : randomUUID();
  }
  @Get('transfer-policy') policy() {
    return this.transfers.policy();
  }
  @Post('transfer-intents') preview(
    @Body() body: unknown,
    @Req() request: { header(name: string): string | undefined },
  ) {
    return this.transfers.createIntent(
      parse(internalTransferIntentRequestSchema, body),
      this.correlation(request),
    );
  }
  @Post('transfer-intents/:intentToken/authorize')
  @HttpCode(204)
  async authorize(
    @Param('intentToken') token: string,
    @Headers('x-aegis-customer-id') customerId?: string,
  ) {
    await this.transfers.authorize(
      this.customer(customerId),
      parse(opaqueIntentTokenSchema, token),
    );
  }
  @Post('transfers') confirm(
    @Body() body: unknown,
    @Req() request: { header(name: string): string | undefined },
  ) {
    return this.transfers.confirm(
      parse(internalTransferConfirmationSchema, body),
      this.correlation(request),
    );
  }
  @Get('customers/:customerId/transfers') list(
    @Param('customerId') customerId: string,
    @Query() query: unknown,
  ) {
    return this.transfers.list(
      parse(uuid, customerId),
      parse(transferListQuerySchema, query),
    );
  }
  @Get('customers/:customerId/transfers/:transferId') detail(
    @Param('customerId') customerId: string,
    @Param('transferId') transferId: string,
  ) {
    return this.transfers.detail(
      parse(uuid, customerId),
      parse(uuid, transferId),
    );
  }
  @Post('recovery/run') recover() {
    return this.transfers.recover();
  }
  @Post('reconciliation') reconcile() {
    return this.reconciliation.run();
  }
}
