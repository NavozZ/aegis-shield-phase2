import {
  internalProvisionDefaultAccountSchema,
  type AccountBalance,
  type CustomerAccountDetail,
  type CustomerAccountList,
  type ProvisionDefaultAccountResult,
} from '@aegis/contracts';
import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { parseInput } from '../common/http/zod';
import { AccountService } from './account.service';

const uuidSchema = z.uuid();

/**
 * Internal routes only. Every route is protected by the internal-token guard,
 * and the customer identity always arrives from the API Gateway — it is never
 * taken from a browser-supplied field.
 */
@Controller('internal')
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  private customerId(header: string | undefined): string {
    return parseInput(uuidSchema, header?.trim());
  }

  @Post('customer-accounts/default')
  provisionDefault(
    @Body() body: unknown,
  ): Promise<ProvisionDefaultAccountResult> {
    return this.accounts.provisionDefault(
      parseInput(internalProvisionDefaultAccountSchema, body),
    );
  }

  @Get('customers/:customerId/accounts')
  list(@Param('customerId') customerId: string): Promise<CustomerAccountList> {
    return this.accounts.listForCustomer(parseInput(uuidSchema, customerId));
  }

  @Get('customer-accounts/:accountId')
  detail(
    @Param('accountId') accountId: string,
    @Headers('x-aegis-customer-id') customerId?: string,
  ): Promise<CustomerAccountDetail> {
    return this.accounts.getForCustomer(
      this.customerId(customerId),
      parseInput(uuidSchema, accountId),
    );
  }

  @Get('customer-accounts/:accountId/balance')
  balance(
    @Param('accountId') accountId: string,
    @Headers('x-aegis-customer-id') customerId?: string,
  ): Promise<AccountBalance> {
    return this.accounts.getBalanceForCustomer(
      this.customerId(customerId),
      parseInput(uuidSchema, accountId),
    );
  }
}
