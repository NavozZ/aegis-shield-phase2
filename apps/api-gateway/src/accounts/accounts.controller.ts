import {
  accountBalanceSchema,
  customerTransactionDetailSchema,
  transactionHistoryQuerySchema,
  transactionHistoryResponseSchema,
  customerAccountDetailSchema,
  customerAccountListSchema,
  idempotencyKeySchema,
  provisionDefaultAccountRequestSchema,
  provisionDefaultAccountResultSchema,
  type AccountBalance,
  type CustomerAccountDetail,
  type CustomerAccountList,
} from '@aegis/contracts';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { requireCsrfToken } from '../common/http/csrf';
import type { RequestContext } from '../common/http/request-context';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway.config';
import { LEDGER_ENDPOINTS, LedgerClient } from './ledger.client';
import { SessionCustomerResolver } from './session-customer';

const accountIdSchema = z.uuid();

function invalidRequest(code: string, message: string): HttpException {
  return new HttpException(
    { error: { code, message } },
    HttpStatus.BAD_REQUEST,
  );
}

/**
 * Browser-facing account routes.
 *
 * Every route requires an authenticated session and derives the customer from
 * it. There is deliberately no route that posts a journal entry: ledger
 * movements are a trusted service-to-service operation.
 */
@Controller('api/v1/accounts')
export class AccountsController {
  constructor(
    private readonly ledger: LedgerClient,
    private readonly sessions: SessionCustomerResolver,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
  ) {}

  private accountId(value: string): string {
    const parsed = accountIdSchema.safeParse(value);
    if (!parsed.success) {
      // A malformed identifier must not be distinguishable from one that simply
      // does not belong to this customer.
      throw new HttpException(
        {
          error: {
            code: 'ACCOUNT_NOT_FOUND',
            message: 'The account could not be found.',
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return parsed.data;
  }

  @Get()
  async list(@Req() request: RequestContext): Promise<CustomerAccountList> {
    const customerId = await this.sessions.resolve(request);
    return this.ledger.request(
      LEDGER_ENDPOINTS.customerAccounts(customerId),
      'GET',
      customerAccountListSchema,
      request,
    );
  }

  @Post('default')
  @HttpCode(HttpStatus.CREATED)
  async provisionDefault(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Headers('x-csrf-token') csrfHeader?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<CustomerAccountDetail> {
    // Precedence is deliberate: who is calling (401), is the call forgeable
    // (403), is it replay-safe (400), is it well-formed (400). An
    // unauthenticated caller must never be told 403 for a missing CSRF token
    // it could not have had.
    const customerId = await this.sessions.resolve(request);
    requireCsrfToken(
      request.header('cookie'),
      this.config.csrfCookieName,
      csrfHeader,
    );
    const key = idempotencyKeySchema.safeParse(idempotencyKey);
    if (!key.success) {
      throw invalidRequest(
        'IDEMPOTENCY_KEY_REQUIRED',
        'A valid Idempotency-Key header is required.',
      );
    }
    if (!provisionDefaultAccountRequestSchema.safeParse(body ?? {}).success) {
      throw invalidRequest('INVALID_REQUEST', 'The request is invalid.');
    }

    const result = await this.ledger.request(
      LEDGER_ENDPOINTS.provisionDefaultAccount,
      'POST',
      provisionDefaultAccountResultSchema,
      request,
      {
        body: {
          customerId,
          productType: 'TIER0_WALLET',
          currency: 'LKR',
          idempotencyKey: key.data,
        },
      },
    );
    return result.account;
  }

  @Get(':accountId')
  async detail(
    @Param('accountId') accountId: string,
    @Req() request: RequestContext,
  ): Promise<CustomerAccountDetail> {
    const customerId = await this.sessions.resolve(request);
    return this.ledger.request(
      LEDGER_ENDPOINTS.customerAccount(this.accountId(accountId)),
      'GET',
      customerAccountDetailSchema,
      request,
      { customerId },
    );
  }

  @Get(':accountId/balance')
  async balance(
    @Param('accountId') accountId: string,
    @Req() request: RequestContext,
  ): Promise<AccountBalance> {
    const customerId = await this.sessions.resolve(request);
    return this.ledger.request(
      LEDGER_ENDPOINTS.customerAccountBalance(this.accountId(accountId)),
      'GET',
      accountBalanceSchema,
      request,
      { customerId },
    );
  }

  @Get(':accountId/transactions')
  async transactions(
    @Param('accountId') accountId: string,
    @Req() request: RequestContext,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const customerId = await this.sessions.resolve(request);
    const parsed = transactionHistoryQuerySchema.safeParse(query);
    if (!parsed.success)
      throw invalidRequest('INVALID_REQUEST', 'The request is invalid.');
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(parsed.data))
      if (value !== undefined) search.set(key, String(value));
    response.setHeader('cache-control', 'private, no-store');
    return this.ledger.request(
      LEDGER_ENDPOINTS.customerTransactions(
        this.accountId(accountId),
        search.size ? `?${search}` : '',
      ),
      'GET',
      transactionHistoryResponseSchema,
      request,
      { customerId },
    );
  }

  @Get(':accountId/transactions/:transactionId')
  async transaction(
    @Param('accountId') accountId: string,
    @Param('transactionId') transactionId: string,
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const customerId = await this.sessions.resolve(request);
    const parsedTransactionId = this.accountId(transactionId);
    response.setHeader('cache-control', 'private, no-store');
    return this.ledger.request(
      LEDGER_ENDPOINTS.customerTransaction(
        this.accountId(accountId),
        parsedTransactionId,
      ),
      'GET',
      customerTransactionDetailSchema,
      request,
      { customerId },
    );
  }
}
