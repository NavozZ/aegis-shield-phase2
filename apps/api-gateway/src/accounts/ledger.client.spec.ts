import { customerAccountListSchema } from '@aegis/contracts';
import type { GatewayConfig } from '../config/gateway.config';
import type { RequestContext } from '../common/http/request-context';
import { LedgerClient } from './ledger.client';
import type { SabclTransportService } from '../sabcl/sabcl-transport.service';

const correlationId = '33333333-3333-4333-8333-333333333333';
const internalToken = 'ledger-internal-token-value';

const config = {
  ledgerServiceUrl: 'http://127.0.0.1:4102',
  ledgerInternalToken: internalToken,
  ledgerTimeoutMs: 5_000,
} as GatewayConfig;

const request = { correlationId } as RequestContext;

function mockFetch(response: { ok: boolean; status: number; body: unknown }): {
  requestHeaders: () => Headers;
} {
  let capturedInit: RequestInit | undefined;
  const fetchMock = jest.fn((_url: URL, init: RequestInit) => {
    capturedInit = init;
    return Promise.resolve({
      ok: response.ok,
      status: response.status,
      json: () => Promise.resolve(response.body),
    });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return {
    requestHeaders: () => {
      if (!(capturedInit?.headers instanceof Headers)) {
        throw new Error('Expected the request to carry a Headers instance.');
      }
      return capturedInit.headers;
    },
  };
}

/**
 * SABCL disabled. These cases cover the direct internal path, which is what
 * runs when SABCL_MODE=off, and they must keep passing unchanged — the whole
 * point of the adapter is that it does not alter existing behaviour.
 * The encrypted path has its own cases in ledger.client.sabcl.spec.ts.
 */
const sabclDisabled = {
  enabled: false,
  strict: false,
  mode: 'off',
} as unknown as SabclTransportService;

describe('LedgerClient', () => {
  const originalFetch = globalThis.fetch;
  const client = new LedgerClient(config, sabclDisabled);

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends the internal token and correlation id server-side only', async () => {
    const { requestHeaders } = mockFetch({
      ok: true,
      status: 200,
      body: { accounts: [] },
    });

    await client.request(
      '/internal/customers/abc/accounts',
      'GET',
      customerAccountListSchema,
      request,
    );

    const headers = requestHeaders();
    expect(headers.get('x-aegis-internal-token')).toBe(internalToken);
    expect(headers.get('x-correlation-id')).toBe(correlationId);
  });

  it('omits the customer header when no customer scope is supplied', async () => {
    const { requestHeaders } = mockFetch({
      ok: true,
      status: 200,
      body: { accounts: [] },
    });

    await client.request(
      '/internal/customers/abc/accounts',
      'GET',
      customerAccountListSchema,
      request,
    );

    expect(requestHeaders().get('x-aegis-customer-id')).toBeNull();
  });

  it('rejects a response that does not satisfy the contract', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: { accounts: [{ id: 'not-a-uuid' }] },
    });

    await expect(
      client.request(
        '/internal/customers/abc/accounts',
        'GET',
        customerAccountListSchema,
        request,
      ),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('preserves an upstream error status and code', async () => {
    mockFetch({
      ok: false,
      status: 404,
      body: {
        error: {
          code: 'ACCOUNT_NOT_FOUND',
          message: 'The account could not be found.',
        },
      },
    });

    await expect(
      client.request(
        '/internal/customer-accounts/abc',
        'GET',
        customerAccountListSchema,
        request,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('normalises a network failure to service unavailable', async () => {
    globalThis.fetch = jest.fn(() =>
      Promise.reject(new Error('connection refused')),
    );

    await expect(
      client.request(
        '/internal/customers/abc/accounts',
        'GET',
        customerAccountListSchema,
        request,
      ),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('reports readiness failures without throwing', async () => {
    globalThis.fetch = jest.fn(() =>
      Promise.reject(new Error('connection refused')),
    );

    await expect(client.ready()).resolves.toBe(false);
  });
});
