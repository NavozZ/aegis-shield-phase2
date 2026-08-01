import {
  internalTransferConfirmationSchema,
  transferConfirmationRequestSchema,
  transferDetailSchema,
  transferListQuerySchema,
  transferListResponseSchema,
  transferPolicySchema,
  transferPreviewRequestSchema,
  transferPreviewResponseSchema,
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
import { readCookie } from '../auth/cookies';
import { IDENTITY_ENDPOINTS, IdentityClient } from '../auth/identity.client';
import { SessionCustomerResolver } from '../accounts/session-customer';
import { requireCsrfToken } from '../common/http/csrf';
import type { RequestContext } from '../common/http/request-context';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway.config';
import { PAYMENTS_ENDPOINTS, PaymentsClient } from './payments.client';
import { RiskClient } from '../risk/risk.client';

const uuid = z.uuid();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new HttpException(
      {
        error: { code: 'INVALID_REQUEST', message: 'The request is invalid.' },
      },
      HttpStatus.BAD_REQUEST,
    );
  return parsed.data;
}

@Controller('api/v1/transfers')
export class TransfersController {
  constructor(
    private readonly payments: PaymentsClient,
    private readonly identity: IdentityClient,
    private readonly sessions: SessionCustomerResolver,
    private readonly risk: RiskClient,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
  ) {}
  private cache(response: Response) {
    response.setHeader('cache-control', 'private, no-store');
  }
  private sessionId(request: RequestContext) {
    return readCookie(request.header('cookie'), this.config.sessionCookieName);
  }
  private async csrf(
    request: RequestContext,
    customerId: string,
    header?: string,
  ) {
    try {
      return requireCsrfToken(
        request.header('cookie'),
        this.config.csrfCookieName,
        header,
      );
    } catch (error) {
      await this.risk.emit(request, {
        eventType: 'CSRF_FAILURE',
        severity: 'MEDIUM',
        subjectId: customerId,
        attributes: { operation: 'TRANSFER', outcome: 'REJECTED' },
      });
      throw error;
    }
  }
  @Get('policy') async policy(
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.sessions.resolve(request);
    this.cache(response);
    return this.payments.request(
      PAYMENTS_ENDPOINTS.policy,
      'GET',
      transferPolicySchema,
      request,
    );
  }
  @Post('preview') async preview(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Headers('x-csrf-token') csrf?: string,
    @Res({ passthrough: true }) response?: Response,
  ) {
    const customerId = await this.sessions.resolve(request);
    await this.csrf(request, customerId, csrf);
    const data = parse(transferPreviewRequestSchema, body);
    if (response) this.cache(response);
    const result = await this.payments.request(
      PAYMENTS_ENDPOINTS.preview,
      'POST',
      transferPreviewResponseSchema,
      request,
      { body: { ...data, senderCustomerId: customerId } },
    );
    await this.risk.emit(request, {
      eventType: 'TRANSFER_PREVIEW',
      severity: 'INFO',
      subjectId: customerId,
      accountId: data.sourceAccountId,
      attributes: {
        operation: 'TRANSFER_PREVIEW',
        amountMinor: result.amount.minorUnits,
        currency: result.amount.currency,
      },
    });
    return result;
  }
  @Post('confirm') @HttpCode(HttpStatus.OK) async confirm(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Headers('x-csrf-token') csrf?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Res({ passthrough: true }) response?: Response,
  ) {
    const customerId = await this.sessions.resolve(request);
    await this.csrf(request, customerId, csrf);
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
    const active = await this.risk.check(request, 'TRANSFER_CONFIRMATION', [
      { type: 'CUSTOMER', id: customerId },
      { type: 'SESSION', id: sessionId },
      { type: 'OPERATION', id: 'operation:transfer-confirmation' },
    ]);
    if (!active.allowed) {
      await this.risk.emit(request, {
        eventType: 'FORBIDDEN_ROUTE',
        severity: 'HIGH',
        subjectId: customerId,
        sessionId,
        attributes: {
          operation: 'TRANSFER_CONFIRMATION',
          outcome: 'CONTROL_BLOCKED',
        },
      });
      throw new HttpException(
        {
          error: {
            code: 'SECURITY_CONTROL_ACTIVE',
            message: 'The transfer cannot be completed.',
          },
        },
        HttpStatus.FORBIDDEN,
      );
    }
    await this.identity.request(
      IDENTITY_ENDPOINTS.transferStepUp,
      'POST',
      request,
      { pin: data.pin },
      { sessionId },
    );
    const assessment = await this.risk.evaluate(request, {
      operation: 'TRANSFER_CONFIRMATION',
      subjectId: customerId,
      sessionId,
      stepUpVerified: true,
    });
    if (!['ALLOW', 'ALLOW_WITH_MONITORING'].includes(assessment.decision)) {
      await this.risk.emit(request, {
        eventType: 'FORBIDDEN_ROUTE',
        severity: assessment.band,
        subjectId: customerId,
        sessionId,
        attributes: {
          operation: 'TRANSFER_CONFIRMATION',
          outcome: assessment.decision,
        },
      });
      throw new HttpException(
        {
          error: {
            code: 'SECURITY_CONTROL_ACTIVE',
            message: 'The transfer cannot be completed.',
          },
        },
        HttpStatus.FORBIDDEN,
      );
    }
    await this.payments.request(
      PAYMENTS_ENDPOINTS.authorize(data.intentToken),
      'POST',
      z.undefined(),
      request,
      { body: {}, customerId },
    );
    const result = await this.payments.request(
      PAYMENTS_ENDPOINTS.confirm,
      'POST',
      transferDetailSchema,
      request,
      {
        body: parse(internalTransferConfirmationSchema, {
          senderCustomerId: customerId,
          intentToken: data.intentToken,
          idempotencyKey: key.data,
        }),
      },
    );
    await this.risk.emit(request, {
      eventType: 'TRANSFER_CONFIRMATION',
      severity: assessment.band === 'LOW' ? 'INFO' : assessment.band,
      subjectId: customerId,
      sessionId,
      attributes: {
        operation: 'TRANSFER_CONFIRMATION',
        outcome: result.status,
      },
    });
    if (response) {
      this.cache(response);
      response.status(
        result.status === 'PROCESSING' ? HttpStatus.ACCEPTED : HttpStatus.OK,
      );
    }
    return result;
  }
  @Get() async list(
    @Req() request: RequestContext,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const customerId = await this.sessions.resolve(request);
    const parsed = parse(transferListQuerySchema, query);
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(parsed))
      if (value !== undefined) search.set(key, String(value));
    this.cache(response);
    return this.payments.request(
      PAYMENTS_ENDPOINTS.transfers(customerId, search.size ? `?${search}` : ''),
      'GET',
      transferListResponseSchema,
      request,
    );
  }
  @Get(':transferId') async detail(
    @Param('transferId') transferId: string,
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const customerId = await this.sessions.resolve(request);
    const id = parse(uuid, transferId);
    this.cache(response);
    return this.payments.request(
      PAYMENTS_ENDPOINTS.transfer(customerId, id),
      'GET',
      transferDetailSchema,
      request,
    );
  }
}
