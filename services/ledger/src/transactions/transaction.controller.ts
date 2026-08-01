import {
  transactionHistoryQuerySchema,
  type CustomerTransactionDetail,
  type TransactionHistoryResponse,
} from '@aegis/contracts';
import { Controller, Get, Headers, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { parseInput } from '../common/http/zod';
import { TransactionService } from './transaction.service';

const uuidSchema = z.uuid();

@Controller('internal/customer-accounts')
export class TransactionController {
  constructor(private readonly transactions: TransactionService) {}
  private customerId(value?: string) {
    return parseInput(uuidSchema, value?.trim());
  }

  @Get(':accountId/transactions')
  list(
    @Param('accountId') accountId: string,
    @Query() query: unknown,
    @Headers('x-aegis-customer-id') customerId?: string,
  ): Promise<TransactionHistoryResponse> {
    return this.transactions.list(
      this.customerId(customerId),
      parseInput(uuidSchema, accountId),
      parseInput(transactionHistoryQuerySchema, query),
    );
  }

  @Get(':accountId/transactions/:transactionId')
  detail(
    @Param('accountId') accountId: string,
    @Param('transactionId') transactionId: string,
    @Headers('x-aegis-customer-id') customerId?: string,
  ): Promise<CustomerTransactionDetail> {
    return this.transactions.detail(
      this.customerId(customerId),
      parseInput(uuidSchema, accountId),
      parseInput(uuidSchema, transactionId),
    );
  }
}
