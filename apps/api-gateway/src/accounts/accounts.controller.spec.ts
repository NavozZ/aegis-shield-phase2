import { HttpException, HttpStatus } from '@nestjs/common';
import type { GatewayConfig } from '../config/gateway.config';
import type { RequestContext } from '../common/http/request-context';
import { AccountsController } from './accounts.controller';
import type { LedgerClient } from './ledger.client';
import type { SessionCustomerResolver } from './session-customer';

const sessionCustomerId = '11111111-1111-4111-8111-111111111111';
const foreignCustomerId = '99999999-9999-4999-8999-999999999999';
const accountId = '22222222-2222-4222-8222-222222222222';
const correlationId = '33333333-3333-4333-8333-333333333333';
const csrfToken = 'csrf-token-value';
const idempotencyKey = 'provision-account-0123456789';
const transactionId = '55555555-5555-4555-8555-555555555555';
const transaction = {
  id: transactionId,
  displayReference: 'AEGIS-TXN-5555-5555-5555',
  accountId,
  direction: 'INCOMING',
  category: 'FUNDING',
  status: 'POSTED',
  amount: { currency: 'LKR', minorUnits: '9007199254740993' },
  balanceAfter: { currency: 'LKR', minorUnits: '9007199254740993' },
  effectiveAt: '2026-08-01T10:00:00.000Z',
  postedAt: '2026-08-01T10:00:01.000Z',
};

const config = {
  csrfCookieName: 'aegis_csrf',
  sessionCookieName: 'aegis_session',
} as GatewayConfig;

const accountDetail = {
  id: accountId,
  maskedReference: 'AEGIS-****-****-8T3W',
  productType: 'TIER0_WALLET',
  status: 'ACTIVE',
  currency: 'LKR',
  createdAt: '2026-07-31T10:00:00.000Z',
  balance: { currency: 'LKR', minorUnits: '0' },
};

function requestWith(cookie?: string): RequestContext {
  return {
    correlationId,
    header: (name: string) => (name === 'cookie' ? cookie : undefined),
  } as unknown as RequestContext;
}

const authenticatedRequest = () =>
  requestWith(`aegis_session=session-value; aegis_csrf=${csrfToken}`);

interface RecordedLedgerCall {
  endpoint: string;
  method: string;
  options?: { body?: unknown; customerId?: string };
}

function buildController(
  options: {
    ledgerResponse?: unknown;
    ledgerError?: Error;
    resolveCustomer?: jest.Mock;
  } = {},
) {
  const ledgerCalls: RecordedLedgerCall[] = [];
  const ledgerRequest = jest.fn(
    (
      endpoint: string,
      method: string,
      _schema: unknown,
      _request: unknown,
      requestOptions?: { body?: unknown; customerId?: string },
    ) => {
      ledgerCalls.push({ endpoint, method, options: requestOptions });
      return options.ledgerError
        ? Promise.reject(options.ledgerError)
        : Promise.resolve(options.ledgerResponse ?? { accounts: [] });
    },
  );
  const ledger = { request: ledgerRequest } as unknown as LedgerClient;
  const resolve =
    options.resolveCustomer ??
    jest.fn(() => Promise.resolve(sessionCustomerId));
  const sessions = { resolve } as unknown as SessionCustomerResolver;

  return {
    controller: new AccountsController(ledger, sessions, config),
    ledgerRequest,
    ledgerCalls,
    resolve,
  };
}

/** Reads the JSON body the controller forwarded to the Ledger. */
function forwardedBody(call: RecordedLedgerCall | undefined): {
  customerId?: string;
  idempotencyKey?: string;
  currency?: string;
} {
  const body = call?.options?.body;
  if (typeof body !== 'object' || body === null) {
    throw new Error('Expected the Ledger call to carry a JSON body.');
  }
  return body;
}

function responseHeaders() {
  const setHeader = jest.fn();
  return { response: { setHeader } as never, setHeader };
}

describe('AccountsController authentication', () => {
  it('requires an authenticated session to list accounts', async () => {
    const resolveCustomer = jest.fn(() =>
      Promise.reject(
        new HttpException(
          { error: { code: 'UNAUTHENTICATED' } },
          HttpStatus.UNAUTHORIZED,
        ),
      ),
    );
    const { controller, ledgerRequest } = buildController({ resolveCustomer });

    await expect(controller.list(requestWith())).rejects.toMatchObject({
      status: 401,
    });
    expect(ledgerRequest).not.toHaveBeenCalled();
  });

  it('answers 401, not 403, when provisioning without a session', async () => {
    const resolveCustomer = jest.fn(() =>
      Promise.reject(
        new HttpException(
          { error: { code: 'UNAUTHENTICATED' } },
          HttpStatus.UNAUTHORIZED,
        ),
      ),
    );
    const { controller, ledgerRequest } = buildController({ resolveCustomer });

    // No cookies, so the CSRF token is absent too. An unauthenticated caller
    // must not be told 403 for a token it could never have supplied.
    await expect(
      controller.provisionDefault({}, requestWith(), undefined, undefined),
    ).rejects.toMatchObject({ status: 401 });
    expect(ledgerRequest).not.toHaveBeenCalled();
  });

  it('uses the customer identifier from the session', async () => {
    const { controller, ledgerRequest } = buildController();

    await controller.list(authenticatedRequest());

    expect(ledgerRequest).toHaveBeenCalledWith(
      `/internal/customers/${sessionCustomerId}/accounts`,
      'GET',
      expect.anything(),
      expect.anything(),
    );
  });

  it('ignores a customer identifier supplied by the browser', async () => {
    const { controller, ledgerRequest } = buildController({
      ledgerResponse: accountDetail,
    });

    await controller
      .provisionDefault(
        { customerId: foreignCustomerId },
        authenticatedRequest(),
        csrfToken,
        idempotencyKey,
      )
      .catch(() => undefined);

    // The strict contract rejects the extra field outright; nothing reaches the
    // Ledger service.
    expect(ledgerRequest).not.toHaveBeenCalled();
  });

  it('never forwards a browser-supplied customer identifier', async () => {
    const { controller, ledgerCalls } = buildController({
      ledgerResponse: { account: accountDetail, created: true },
    });

    await controller.provisionDefault(
      {},
      authenticatedRequest(),
      csrfToken,
      idempotencyKey,
    );

    expect(forwardedBody(ledgerCalls[0]).customerId).toBe(sessionCustomerId);
    expect(JSON.stringify(ledgerCalls[0])).not.toContain(foreignCustomerId);
  });
});

describe('AccountsController provisioning safeguards', () => {
  it('requires a CSRF token', async () => {
    const { controller, ledgerRequest } = buildController();

    await expect(
      controller.provisionDefault(
        {},
        authenticatedRequest(),
        undefined,
        idempotencyKey,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(ledgerRequest).not.toHaveBeenCalled();
  });

  it('rejects a mismatched CSRF token', async () => {
    const { controller } = buildController();

    await expect(
      controller.provisionDefault(
        {},
        authenticatedRequest(),
        'wrong-token-val',
        idempotencyKey,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('requires an idempotency key', async () => {
    const { controller, ledgerRequest } = buildController();

    await expect(
      controller.provisionDefault(
        {},
        authenticatedRequest(),
        csrfToken,
        undefined,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(ledgerRequest).not.toHaveBeenCalled();
  });

  it('rejects a malformed idempotency key', async () => {
    const { controller } = buildController();

    await expect(
      controller.provisionDefault(
        {},
        authenticatedRequest(),
        csrfToken,
        'short',
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('forwards the validated key and returns only the account', async () => {
    const { controller, ledgerCalls } = buildController({
      ledgerResponse: { account: accountDetail, created: true },
    });

    const result = await controller.provisionDefault(
      {},
      authenticatedRequest(),
      csrfToken,
      idempotencyKey,
    );

    expect(result).toEqual(accountDetail);
    const body = forwardedBody(ledgerCalls[0]);
    expect(body.idempotencyKey).toBe(idempotencyKey);
    expect(body.currency).toBe('LKR');
  });
});

describe('AccountsController ownership and failure handling', () => {
  it('returns not found for a malformed account identifier', async () => {
    const { controller, ledgerRequest } = buildController();

    await expect(
      controller.detail('not-a-uuid', authenticatedRequest()),
    ).rejects.toMatchObject({ status: 404 });
    expect(ledgerRequest).not.toHaveBeenCalled();
  });

  it('passes the session customer to the ledger for ownership scoping', async () => {
    const { controller, ledgerRequest } = buildController({
      ledgerResponse: accountDetail,
    });

    await controller.detail(accountId, authenticatedRequest());

    expect(ledgerRequest).toHaveBeenCalledWith(
      `/internal/customer-accounts/${accountId}`,
      'GET',
      expect.anything(),
      expect.anything(),
      { customerId: sessionCustomerId },
    );
  });

  it('surfaces a ledger not-found without revealing another customer account', async () => {
    const { controller } = buildController({
      ledgerError: new HttpException(
        {
          error: {
            code: 'ACCOUNT_NOT_FOUND',
            message: 'The account could not be found.',
          },
        },
        HttpStatus.NOT_FOUND,
      ),
    });

    await expect(
      controller.detail(accountId, authenticatedRequest()),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('normalises a ledger outage to a service-unavailable response', async () => {
    const { controller } = buildController({
      ledgerError: new HttpException(
        { error: { code: 'LEDGER_UNAVAILABLE' } },
        HttpStatus.SERVICE_UNAVAILABLE,
      ),
    });

    await expect(
      controller.balance(accountId, authenticatedRequest()),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('requests the balance endpoint with the session customer', async () => {
    const { controller, ledgerRequest } = buildController({
      ledgerResponse: {
        accountId,
        balance: { currency: 'LKR', minorUnits: '0' },
        updatedAt: '2026-07-31T10:00:00.000Z',
      },
    });

    await controller.balance(accountId, authenticatedRequest());

    expect(ledgerRequest).toHaveBeenCalledWith(
      `/internal/customer-accounts/${accountId}/balance`,
      'GET',
      expect.anything(),
      expect.anything(),
      { customerId: sessionCustomerId },
    );
  });
});

describe('AccountsController transaction reads', () => {
  it.each(['history', 'detail'])(
    'requires authentication for %s',
    async (kind) => {
      const resolveCustomer = jest.fn(() =>
        Promise.reject(
          new HttpException(
            { error: { code: 'UNAUTHENTICATED' } },
            HttpStatus.UNAUTHORIZED,
          ),
        ),
      );
      const { controller, ledgerRequest } = buildController({
        resolveCustomer,
      });
      const { response } = responseHeaders();
      const result =
        kind === 'history'
          ? controller.transactions(accountId, requestWith(), {}, response)
          : controller.transaction(
              accountId,
              transactionId,
              requestWith(),
              response,
            );
      await expect(result).rejects.toMatchObject({ status: 401 });
      expect(ledgerRequest).not.toHaveBeenCalled();
    },
  );

  it('forwards only validated filters and the session customer', async () => {
    const { controller, ledgerRequest } = buildController({
      ledgerResponse: { transactions: [transaction], nextCursor: null },
    });
    const { response, setHeader } = responseHeaders();
    await controller
      .transactions(
        accountId,
        authenticatedRequest(),
        {
          direction: 'INCOMING',
          category: 'FUNDING',
          pageSize: '20',
          customerId: foreignCustomerId,
        },
        response,
      )
      .catch(() => undefined);
    expect(ledgerRequest).not.toHaveBeenCalled();
    await controller.transactions(
      accountId,
      authenticatedRequest(),
      { direction: 'INCOMING', category: 'FUNDING', pageSize: '20' },
      response,
    );
    expect(ledgerRequest).toHaveBeenCalledWith(
      `/internal/customer-accounts/${accountId}/transactions?direction=INCOMING&category=FUNDING&pageSize=20`,
      'GET',
      expect.anything(),
      expect.anything(),
      { customerId: sessionCustomerId },
    );
    expect(setHeader).toHaveBeenCalledWith(
      'cache-control',
      'private, no-store',
    );
  });

  it.each([
    { cursor: 'x'.repeat(1025) },
    { pageSize: '51' },
    {
      dateFrom: '2026-08-02T00:00:00.000Z',
      dateTo: '2026-08-01T00:00:00.000Z',
    },
  ])('rejects invalid transaction query %#', async (invalid) => {
    const { controller, ledgerRequest } = buildController();
    await expect(
      controller.transactions(
        accountId,
        authenticatedRequest(),
        invalid,
        responseHeaders().response,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(ledgerRequest).not.toHaveBeenCalled();
  });

  it('forwards transaction detail with ownership context and private caching', async () => {
    const { controller, ledgerRequest } = buildController({
      ledgerResponse: {
        ...transaction,
        maskedAccountReference: 'AEGIS-****-****-8T3W',
        productType: 'TIER0_WALLET',
      },
    });
    const { response, setHeader } = responseHeaders();
    await controller.transaction(
      accountId,
      transactionId,
      authenticatedRequest(),
      response,
    );
    expect(ledgerRequest).toHaveBeenCalledWith(
      `/internal/customer-accounts/${accountId}/transactions/${transactionId}`,
      'GET',
      expect.anything(),
      expect.anything(),
      { customerId: sessionCustomerId },
    );
    expect(setHeader).toHaveBeenCalledWith(
      'cache-control',
      'private, no-store',
    );
  });

  it('conceals malformed account and transaction identifiers as 404', async () => {
    const { controller, ledgerRequest } = buildController();
    await expect(
      controller.transaction(
        accountId,
        'bad-id',
        authenticatedRequest(),
        responseHeaders().response,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      controller.transactions(
        'bad-id',
        authenticatedRequest(),
        {},
        responseHeaders().response,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(ledgerRequest).not.toHaveBeenCalled();
  });

  it('preserves safe Ledger 404 and 503 failures', async () => {
    const notFound = buildController({
      ledgerError: new HttpException(
        { error: { code: 'ACCOUNT_NOT_FOUND' } },
        404,
      ),
    });
    await expect(
      notFound.controller.transaction(
        accountId,
        transactionId,
        authenticatedRequest(),
        responseHeaders().response,
      ),
    ).rejects.toMatchObject({ status: 404 });
    const unavailable = buildController({
      ledgerError: new HttpException(
        { error: { code: 'LEDGER_UNAVAILABLE' } },
        503,
      ),
    });
    await expect(
      unavailable.controller.transactions(
        accountId,
        authenticatedRequest(),
        {},
        responseHeaders().response,
      ),
    ).rejects.toMatchObject({ status: 503 });
  });
});
