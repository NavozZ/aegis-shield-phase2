import { HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import type { IdentityClient } from '../auth/identity.client';
import type { RequestContext } from '../common/http/request-context';
import type { GatewayConfig } from '../config/gateway.config';
import type { SessionCustomerResolver } from '../accounts/session-customer';
import type { PaymentsClient } from './payments.client';
import type { RiskClient } from '../risk/risk.client';
import { TransfersController } from './transfers.controller';

const customerId = '11111111-1111-4111-8111-111111111111';
const foreignCustomerId = '99999999-9999-4999-8999-999999999999';
const sourceAccountId = '22222222-2222-4222-8222-222222222222';
const transferId = '44444444-4444-4444-8444-444444444444';
const transactionId = '55555555-5555-4555-8555-555555555555';
const correlationId = '33333333-3333-4333-8333-333333333333';
const csrfToken = 'csrf-token-value';
const intentToken = 'a'.repeat(43);
const idempotencyKey = 'confirm-transfer-0123456789';
const config = {
  csrfCookieName: 'aegis_csrf',
  sessionCookieName: 'aegis_session',
} as GatewayConfig;

const detail = {
  id: transferId,
  displayReference: 'AEGIS-TRF-ABCD-EFGH-JKLM',
  direction: 'OUTGOING',
  status: 'COMPLETED',
  accountId: sourceAccountId,
  counterpartyMaskedReference: 'AEGIS-****-****-JKLM',
  amount: { currency: 'LKR', minorUnits: '10000' },
  createdAt: '2026-08-01T10:00:00.000Z',
  completedAt: '2026-08-01T10:00:01.000Z',
  transactionId,
  balanceAfter: { currency: 'LKR', minorUnits: '50000' },
  failureCode: null,
  ownMaskedReference: 'AEGIS-****-****-ABCD',
};

function request(
  cookie = `aegis_session=session-value; aegis_csrf=${csrfToken}`,
) {
  return {
    correlationId,
    header: (name: string) => (name === 'cookie' ? cookie : undefined),
  } as unknown as RequestContext;
}

function response() {
  return {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

function build(
  options: {
    resolve?: jest.Mock;
    paymentResult?: unknown;
    riskCheck?: unknown;
    riskAssessment?: unknown;
  } = {},
) {
  const paymentRequest = jest
    .fn()
    .mockResolvedValue(options.paymentResult ?? detail);
  const identityRequest = jest.fn().mockResolvedValue(undefined);
  const resolve = options.resolve ?? jest.fn().mockResolvedValue(customerId);
  const riskCheck = jest.fn().mockResolvedValue(
    options.riskCheck ?? {
      allowed: true,
      decision: 'ALLOW',
      reasonCodes: [],
      requiresStepUp: false,
      expiresAt: null,
    },
  );
  const riskEvaluate = jest.fn().mockResolvedValue(
    options.riskAssessment ?? {
      assessmentId: '77777777-7777-4777-8777-777777777777',
      score: 0,
      band: 'LOW',
      decision: 'ALLOW',
      triggeredRules: [],
      reasonCodes: [],
      controlRecommendation: null,
      expiresAt: '2026-08-01T10:05:00.000Z',
      ruleSetVersion: 'risk-rules-2026-08-v1',
      publicExplanation: 'No additional verification is required.',
    },
  );
  return {
    controller: new TransfersController(
      { request: paymentRequest } as unknown as PaymentsClient,
      { request: identityRequest } as unknown as IdentityClient,
      { resolve } as unknown as SessionCustomerResolver,
      {
        check: riskCheck,
        evaluate: riskEvaluate,
        emit: jest.fn().mockResolvedValue(undefined),
      } as unknown as RiskClient,
      config,
    ),
    paymentRequest,
    identityRequest,
    riskCheck,
    riskEvaluate,
  };
}

describe('TransfersController trust boundary', () => {
  it('checks authentication before CSRF', async () => {
    const resolve = jest
      .fn()
      .mockRejectedValue(
        new HttpException(
          { error: { code: 'UNAUTHENTICATED' } },
          HttpStatus.UNAUTHORIZED,
        ),
      );
    const { controller, paymentRequest } = build({ resolve });
    await expect(
      controller.preview({}, request(''), undefined, response()),
    ).rejects.toMatchObject({ status: 401 });
    expect(paymentRequest).not.toHaveBeenCalled();
  });

  it('rejects missing CSRF before contacting Payments', async () => {
    const { controller, paymentRequest } = build();
    await expect(
      controller.preview({}, request(), undefined, response()),
    ).rejects.toMatchObject({ status: 403 });
    expect(paymentRequest).not.toHaveBeenCalled();
  });

  it('rejects browser-supplied customer identity', async () => {
    const { controller, paymentRequest } = build();
    await expect(
      controller.preview(
        {
          sourceAccountId,
          recipientReference: 'AEGIS-ABCD-EFGH-JKLM',
          amount: '100.00',
          customerId: foreignCustomerId,
        },
        request(),
        csrfToken,
        response(),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(paymentRequest).not.toHaveBeenCalled();
  });

  it('adds only the authenticated customer to a valid preview', async () => {
    const preview = {
      intentToken,
      sourceMaskedReference: 'AEGIS-****-****-ABCD',
      recipientMaskedReference: 'AEGIS-****-****-JKLM',
      amount: { currency: 'LKR', minorUnits: '10000' },
      sourceBalance: { currency: 'LKR', minorUnits: '60000' },
      policy: {
        currency: 'LKR',
        minimum: { currency: 'LKR', minorUnits: '100' },
        maximum: { currency: 'LKR', minorUnits: '10000000' },
        dailyOutgoingMaximum: { currency: 'LKR', minorUnits: '25000000' },
      },
      expiresAt: '2026-08-01T10:05:00.000Z',
    };
    const { controller, paymentRequest } = build({ paymentResult: preview });
    await controller.preview(
      {
        sourceAccountId,
        recipientReference: 'AEGIS-ABCD-EFGH-JKLM',
        amount: '100.00',
      },
      request(),
      csrfToken,
      response(),
    );
    expect(paymentRequest).toHaveBeenCalledWith(
      '/internal/transfer-intents',
      'POST',
      expect.anything(),
      expect.anything(),
      {
        body: {
          sourceAccountId,
          recipientReference: 'AEGIS-ABCD-EFGH-JKLM',
          amount: '100.00',
          senderCustomerId: customerId,
        },
      },
    );
  });

  it('sends the PIN only to Identity and forwards the idempotency key to Payments', async () => {
    const { controller, identityRequest, paymentRequest } = build();
    const res = response();
    await controller.confirm(
      { intentToken, pin: '123456' },
      request(),
      csrfToken,
      idempotencyKey,
      res,
    );
    expect(identityRequest).toHaveBeenCalledWith(
      '/api/v1/auth/transfer-step-up',
      'POST',
      expect.anything(),
      { pin: '123456' },
      { sessionId: 'session-value' },
    );
    expect(paymentRequest).toHaveBeenNthCalledWith(
      1,
      `/internal/transfer-intents/${intentToken}/authorize`,
      'POST',
      expect.anything(),
      expect.anything(),
      { body: {}, customerId },
    );
    expect(paymentRequest).toHaveBeenLastCalledWith(
      '/internal/transfers',
      'POST',
      expect.anything(),
      expect.anything(),
      { body: { senderCustomerId: customerId, intentToken, idempotencyKey } },
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(res.setHeader).toHaveBeenCalledWith(
      'cache-control',
      'private, no-store',
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 202 while a confirmation is still processing', async () => {
    const { controller } = build({
      paymentResult: {
        ...detail,
        status: 'PROCESSING',
        completedAt: null,
        transactionId: null,
        balanceAfter: null,
      },
    });
    const res = response();
    await controller.confirm(
      { intentToken, pin: '123456' },
      request(),
      csrfToken,
      idempotencyKey,
      res,
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('fails closed before step-up and Payments when an active control blocks confirmation', async () => {
    const { controller, identityRequest, paymentRequest } = build({
      riskCheck: {
        allowed: false,
        decision: 'BLOCK',
        reasonCodes: ['ACTIVE_BLOCK'],
        requiresStepUp: false,
        expiresAt: '2026-08-01T10:05:00.000Z',
      },
    });
    await expect(
      controller.confirm(
        { intentToken, pin: '739182' },
        request(),
        csrfToken,
        idempotencyKey,
        response(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(identityRequest).not.toHaveBeenCalled();
    expect(paymentRequest).not.toHaveBeenCalled();
  });

  it('rejects a hold decision after step-up without forwarding a forged decision to Payments', async () => {
    const { controller, paymentRequest, riskEvaluate } = build({
      riskAssessment: {
        assessmentId: '77777777-7777-4777-8777-777777777777',
        score: 60,
        band: 'HIGH',
        decision: 'HOLD_FOR_REVIEW',
        triggeredRules: ['REPLAY_PATTERN'],
        reasonCodes: ['REPLAY_LIKE_BEHAVIOUR'],
        controlRecommendation: 'TRANSFER_HOLD',
        expiresAt: '2026-08-01T10:05:00.000Z',
        ruleSetVersion: 'risk-rules-2026-08-v1',
        publicExplanation:
          'The operation cannot continue while a security review is active.',
      },
    });
    await expect(
      controller.confirm(
        { intentToken, pin: '739182' },
        request(),
        csrfToken,
        idempotencyKey,
        response(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(riskEvaluate).toHaveBeenCalledTimes(1);
    expect(paymentRequest).not.toHaveBeenCalled();
  });

  it.each([undefined, 'short'])(
    'rejects invalid idempotency key %p',
    async (key) => {
      const { controller, identityRequest, paymentRequest } = build();
      await expect(
        controller.confirm(
          { intentToken, pin: '123456' },
          request(),
          csrfToken,
          key,
          response(),
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(identityRequest).not.toHaveBeenCalled();
      expect(paymentRequest).not.toHaveBeenCalled();
    },
  );

  it('scopes list and detail reads to the authenticated customer', async () => {
    const { controller, paymentRequest } = build({
      paymentResult: { transfers: [], nextCursor: null },
    });
    const listResponse = response();
    await controller.list(
      request(),
      { direction: 'SENT', pageSize: '20' },
      listResponse,
    );
    expect(paymentRequest).toHaveBeenCalledWith(
      `/internal/customers/${customerId}/transfers?direction=SENT&pageSize=20`,
      'GET',
      expect.anything(),
      expect.anything(),
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(listResponse.setHeader).toHaveBeenCalledWith(
      'cache-control',
      'private, no-store',
    );

    paymentRequest.mockResolvedValue(detail);
    await controller.detail(transferId, request(), response());
    expect(paymentRequest).toHaveBeenLastCalledWith(
      `/internal/customers/${customerId}/transfers/${transferId}`,
      'GET',
      expect.anything(),
      expect.anything(),
    );
  });

  it('rejects query identity injection and malformed transfer ids', async () => {
    const { controller, paymentRequest } = build();
    await expect(
      controller.list(request(), { customerId: foreignCustomerId }, response()),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      controller.detail('bad-id', request(), response()),
    ).rejects.toMatchObject({ status: 400 });
    expect(paymentRequest).not.toHaveBeenCalled();
  });
});
