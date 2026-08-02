import {
  agentCashInPreviewRequestSchema,
  agentCashOutPreviewRequestSchema,
  qrReceiveRequestSchema,
  qrDynamicRequestSchema,
  qrPreviewRequestSchema,
  qrIssueResponseSchema,
  transferPreviewResponseSchema,
  transferConfirmationRequestSchema,
  transferDetailSchema,
  internalQrIssueRequestSchema,
  agentCashPreviewResponseSchema,
  agentCashResultSchema,
} from '@aegis/contracts';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { SessionCustomerResolver } from '../accounts/session-customer';
import { IdentityClient, IDENTITY_ENDPOINTS } from '../auth/identity.client';
import { requireCsrfToken } from '../common/http/csrf';
import type { RequestContext } from '../common/http/request-context';
import {
  PaymentsClient,
  PAYMENTS_ENDPOINTS,
} from '../transfers/payments.client';
import { readCookie } from '../auth/cookies';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway.config';
import { Inject } from '@nestjs/common';

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpException(
      {
        error: { code: 'INVALID_REQUEST', message: 'The request is invalid.' },
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  return parsed.data;
}

@Controller('api/v1/channels')
export class ChannelsController {
  constructor(
    private readonly payments: PaymentsClient,
    private readonly identity: IdentityClient,
    private readonly sessions: SessionCustomerResolver,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
  ) {}

  private cache(response: Response) {
    response.setHeader('cache-control', 'private, no-store');
  }

  private sessionId(request: RequestContext) {
    return readCookie(request.header('cookie'), this.config.sessionCookieName);
  }

  private csrf(request: RequestContext, header?: string) {
    return requireCsrfToken(
      request.header('cookie'),
      this.config.csrfCookieName,
      header,
    );
  }

  // --- QR Payments ---

  @Post('qr/receive')
  async qrReceive(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Headers('x-csrf-token') csrf?: string,
    @Res({ passthrough: true }) response?: Response,
  ) {
    const customerId = await this.sessions.resolve(request);
    this.csrf(request, csrf);
    const data = parse(qrReceiveRequestSchema, body);

    if (response) this.cache(response);

    return this.payments.request(
      PAYMENTS_ENDPOINTS.qrIssue,
      'POST',
      qrIssueResponseSchema,
      request,
      {
        body: parse(internalQrIssueRequestSchema, {
          customerId,
          accountId: data.sourceAccountId,
          type: 'STATIC',
          currency: 'LKR',
        }),
      },
    );
  }

  @Post('qr/dynamic')
  async qrDynamic(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Headers('x-csrf-token') csrf?: string,
    @Res({ passthrough: true }) response?: Response,
  ) {
    const customerId = await this.sessions.resolve(request);
    this.csrf(request, csrf);
    const data = parse(qrDynamicRequestSchema, body);

    if (response) this.cache(response);

    return this.payments.request(
      PAYMENTS_ENDPOINTS.qrIssue,
      'POST',
      qrIssueResponseSchema,
      request,
      {
        body: parse(internalQrIssueRequestSchema, {
          customerId,
          accountId: data.sourceAccountId,
          type: 'DYNAMIC',
          amountMinor: data.amount,
          currency: data.currency,
          purpose: data.purpose,
        }),
      },
    );
  }

  @Post('qr/preview')
  async qrPreview(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Headers('x-csrf-token') csrf?: string,
    @Res({ passthrough: true }) response?: Response,
  ) {
    const customerId = await this.sessions.resolve(request);
    this.csrf(request, csrf);
    const data = parse(qrPreviewRequestSchema, body);

    if (response) this.cache(response);

    return this.payments.request(
      PAYMENTS_ENDPOINTS.qrPreview,
      'POST',
      transferPreviewResponseSchema,
      request,
      {
        body: {
          payload: data.payload,
          senderCustomerId: customerId,
          sourceAccountId: data.sourceAccountId,
        },
      },
    );
  }

  @Post('qr/confirm')
  @HttpCode(HttpStatus.OK)
  async qrConfirm(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Headers('x-csrf-token') csrf?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Res({ passthrough: true }) response?: Response,
  ) {
    const customerId = await this.sessions.resolve(request);
    this.csrf(request, csrf);
    const data = parse(transferConfirmationRequestSchema, body);

    const key = z
      .string()
      .regex(/^[A-Za-z0-9._:-]{16,128}$/u)
      .safeParse(idempotencyKey);
    if (!key.success)
      throw new HttpException(
        { error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } },
        HttpStatus.BAD_REQUEST,
      );

    const sessionId = this.sessionId(request);
    if (!sessionId)
      throw new HttpException(
        { error: { code: 'UNAUTHENTICATED' } },
        HttpStatus.UNAUTHORIZED,
      );

    await this.identity.request(
      IDENTITY_ENDPOINTS.transferStepUp,
      'POST',
      request,
      { pin: data.pin },
      { sessionId },
    );

    const result = await this.payments.request(
      PAYMENTS_ENDPOINTS.qrRedeem,
      'POST',
      transferDetailSchema,
      request,
      {
        body: {
          senderCustomerId: customerId,
          intentToken: data.intentToken,
          idempotencyKey: key.data,
        },
      },
    );

    if (response) {
      this.cache(response);
      response.status(
        result.status === 'PROCESSING' ? HttpStatus.ACCEPTED : HttpStatus.OK,
      );
    }
    return result;
  }

  // --- Agent Cash ---

  @Post('agent/cash-in/preview')
  async agentCashInPreview(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Headers('x-csrf-token') csrf?: string,
    @Res({ passthrough: true }) response?: Response,
  ) {
    // KNOWN DEFECT: this is an ordinary customer session identifier, not an
    // authenticated agent identity, and no agent role is checked. Any signed-in
    // customer can therefore reach agent cash operations. Recorded as release
    // blocker B-6 in docs/release/final-security-review.md and deliberately not
    // fixed in this release.
    const agentId = await this.sessions.resolve(request);
    this.csrf(request, csrf);
    const data = parse(agentCashInPreviewRequestSchema, body);

    if (response) this.cache(response);

    return this.payments.request(
      PAYMENTS_ENDPOINTS.agentCashInPreview,
      'POST',
      agentCashPreviewResponseSchema,
      request,
      {
        body: {
          agentId,
          agentReference: 'AEGIS-AGT-0000', // Usually fetched from agent profile
          customerReference: data.customerReference,
          amountMinor: data.amountMinor,
          currency: data.currency,
        },
      },
    );
  }

  @Post('agent/cash-out/preview')
  async agentCashOutPreview(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Headers('x-csrf-token') csrf?: string,
    @Res({ passthrough: true }) response?: Response,
  ) {
    const agentId = await this.sessions.resolve(request);
    this.csrf(request, csrf);
    const data = parse(agentCashOutPreviewRequestSchema, body);

    if (response) this.cache(response);

    return this.payments.request(
      PAYMENTS_ENDPOINTS.agentCashOutPreview,
      'POST',
      agentCashPreviewResponseSchema,
      request,
      {
        body: {
          agentId,
          agentReference: 'AEGIS-AGT-0000',
          customerReference: data.customerReference,
          amountMinor: data.amountMinor,
          currency: data.currency,
        },
      },
    );
  }

  @Post('agent/cash/confirm')
  @HttpCode(HttpStatus.OK)
  async agentCashConfirm(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Headers('x-csrf-token') csrf?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Res({ passthrough: true }) response?: Response,
  ) {
    const agentId = await this.sessions.resolve(request);
    this.csrf(request, csrf);
    const data = parse(transferConfirmationRequestSchema, body);

    const key = z
      .string()
      .regex(/^[A-Za-z0-9._:-]{16,128}$/u)
      .safeParse(idempotencyKey);
    if (!key.success)
      throw new HttpException(
        { error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } },
        HttpStatus.BAD_REQUEST,
      );

    const sessionId = this.sessionId(request);
    if (!sessionId)
      throw new HttpException(
        { error: { code: 'UNAUTHENTICATED' } },
        HttpStatus.UNAUTHORIZED,
      );

    await this.identity.request(
      IDENTITY_ENDPOINTS.transferStepUp,
      'POST',
      request,
      { pin: data.pin },
      { sessionId },
    );

    const result = await this.payments.request(
      PAYMENTS_ENDPOINTS.agentCashConfirm,
      'POST',
      agentCashResultSchema,
      request,
      {
        body: {
          agentId,
          intentToken: data.intentToken,
          idempotencyKey: key.data,
        },
      },
    );

    if (response) {
      this.cache(response);
      response.status(
        result.status === 'PROCESSING' ? HttpStatus.ACCEPTED : HttpStatus.OK,
      );
    }
    return result;
  }

  // --- USSD ---

  @Post('ussd/simulate')
  @HttpCode(HttpStatus.OK)
  async ussdSimulate(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Headers('x-csrf-token') csrf?: string,
    @Res({ passthrough: true }) response?: Response,
  ) {
    const customerId = await this.sessions.resolve(request);
    this.csrf(request, csrf);

    // We pass customerId in the internal request to allow simulator to skip MSISDN auth
    if (response) this.cache(response);

    return this.payments.request(
      '/internal/ussd/simulate',
      'POST',
      z.unknown(),
      request,
      {
        body,
        customerId,
      },
    );
  }

  @Post('ussd/webhook')
  @HttpCode(HttpStatus.OK)
  async ussdWebhook(@Body() body: unknown, @Req() request: RequestContext) {
    // Webhook has no session auth, MSISDN auth is done by Payments/Identity
    return this.payments.request(
      '/internal/ussd/webhook',
      'POST',
      z.unknown(),
      request,
      { body },
    );
  }
}
