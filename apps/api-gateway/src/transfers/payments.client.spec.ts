import { transferListResponseSchema } from '@aegis/contracts';
import type { GatewayConfig } from '../config/gateway.config';
import type { RequestContext } from '../common/http/request-context';
import { PaymentsClient } from './payments.client';
import type { SabclTransportService } from '../sabcl/sabcl-transport.service';

const correlationId = '33333333-3333-4333-8333-333333333333';
const customerId = '11111111-1111-4111-8111-111111111111';
const internalToken = 'payments-internal-token-value';
const config = {
  paymentsServiceUrl: 'http://127.0.0.1:4104',
  paymentsInternalToken: internalToken,
  paymentsTimeoutMs: 5_000,
} as GatewayConfig;
const request = { correlationId } as RequestContext;

function mockFetch(response: { ok: boolean; status: number; body: unknown }) {
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = jest.fn((_url: URL, init: RequestInit) => {
    capturedInit = init;
    return Promise.resolve({
      ok: response.ok,
      status: response.status,
      json: () => Promise.resolve(response.body),
    });
  }) as unknown as typeof fetch;
  return () => {
    if (!(capturedInit?.headers instanceof Headers))
      throw new Error('Expected request headers.');
    return capturedInit.headers;
  };
}

/** SABCL disabled: these cases pin the direct internal path's behaviour. */
const sabclDisabled = {
  enabled: false,
  strict: false,
  mode: 'off',
} as unknown as SabclTransportService;

describe('PaymentsClient', () => {
  const originalFetch = globalThis.fetch;
  const client = new PaymentsClient(config, sabclDisabled);

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('adds only server-owned authentication and tracing headers', async () => {
    const headers = mockFetch({
      ok: true,
      status: 200,
      body: { transfers: [], nextCursor: null },
    });
    await client.request(
      `/internal/customers/${customerId}/transfers`,
      'GET',
      transferListResponseSchema,
      request,
      { customerId },
    );
    expect(headers().get('x-aegis-internal-token')).toBe(internalToken);
    expect(headers().get('x-correlation-id')).toBe(correlationId);
    expect(headers().get('x-aegis-customer-id')).toBe(customerId);
  });

  it('rejects a successful response outside the shared contract', async () => {
    mockFetch({ ok: true, status: 200, body: { transfers: 'not-an-array' } });
    await expect(
      client.request(
        '/internal/transfers',
        'GET',
        transferListResponseSchema,
        request,
      ),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('preserves a safe downstream error status and body', async () => {
    mockFetch({
      ok: false,
      status: 409,
      body: { error: { code: 'IDEMPOTENCY_KEY_REUSED' } },
    });
    await expect(
      client.request(
        '/internal/transfers',
        'POST',
        transferListResponseSchema,
        request,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('normalises network failures to service unavailable', async () => {
    globalThis.fetch = jest.fn(() => Promise.reject(new Error('offline')));
    await expect(
      client.request(
        '/internal/transfers',
        'POST',
        transferListResponseSchema,
        request,
      ),
    ).rejects.toMatchObject({ status: 503 });
  });
});
