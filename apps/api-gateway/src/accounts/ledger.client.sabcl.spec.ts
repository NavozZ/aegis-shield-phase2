import { customerAccountListSchema } from '@aegis/contracts';
import { SabclError, type SabclInnerResponse } from '@aegis/sabcl';
import { HttpException } from '@nestjs/common';
import type { GatewayConfig } from '../config/gateway.config';
import type { RequestContext } from '../common/http/request-context';
import { LedgerClient } from './ledger.client';
import type {
  SabclCallOptions,
  SabclTransportService,
} from '../sabcl/sabcl-transport.service';

/*
 * The gateway's encrypted path.
 *
 * The transport is stubbed so these stay unit tests: what is under test is that
 * the client routes through SABCL rather than fetch, picks the right
 * capability, keeps the customer identifier in the encrypted payload, and does
 * not fall back in strict mode.
 */

const correlationId = '33333333-3333-4333-8333-333333333333';
const config = {
  ledgerServiceUrl: 'http://127.0.0.1:4102',
  ledgerInternalToken: 'ledger-internal-token-value',
  ledgerTimeoutMs: 5_000,
} as GatewayConfig;
const request = { correlationId } as RequestContext;

function stubTransport(options: {
  strict: boolean;
  /** Returns the inner response, or throws to simulate a transport failure. */
  respond?: (call: SabclCallOptions) => SabclInnerResponse;
}) {
  const calls: SabclCallOptions[] = [];
  const transport = {
    enabled: true,
    strict: options.strict,
    mode: options.strict ? 'strict' : 'compatible',
    call: jest.fn((call: SabclCallOptions): Promise<SabclInnerResponse> => {
      calls.push(call);
      // `respond` throwing synchronously must surface as a rejected promise,
      // the way a real transport failure would.
      try {
        return Promise.resolve(
          options.respond?.(call) ?? { status: 200, body: { accounts: [] } },
        );
      } catch (error) {
        return Promise.reject(error as Error);
      }
    }),
  } as unknown as SabclTransportService;
  return { transport, calls };
}

describe('LedgerClient over SABCL', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = jest.fn(() => {
      throw new Error('the encrypted path must not use fetch directly');
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('routes through the transport instead of calling the ledger directly', async () => {
    const { transport, calls } = stubTransport({ strict: true });
    const client = new LedgerClient(config, transport);

    const result = await client.request(
      '/internal/customers/cus_1/accounts',
      'GET',
      customerAccountListSchema,
      request,
      { customerId: 'cus_1' },
    );

    expect(result).toEqual({ accounts: [] });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it('keeps the customer identifier inside the encrypted payload', async () => {
    const { transport, calls } = stubTransport({ strict: true });
    const client = new LedgerClient(config, transport);

    await client.request(
      '/internal/customers/cus_secret/accounts',
      'GET',
      customerAccountListSchema,
      request,
      { customerId: 'cus_secret' },
    );

    // The identifier is an argument to the encrypted call, not a header on a
    // plaintext request. That is the whole distinction this phase introduces.
    expect(calls[0]?.customerId).toBe('cus_secret');
    expect(calls[0]?.path).toBe('/internal/customers/cus_secret/accounts');
  });

  it('selects the read capability for account paths', async () => {
    const { transport, calls } = stubTransport({ strict: true });
    const client = new LedgerClient(config, transport);
    await client.request(
      '/internal/customer-accounts/acc_1/balance',
      'GET',
      customerAccountListSchema.or(customerAccountListSchema),
      request,
    );
    expect(calls[0]?.capability).toBe('ledger.accounts');
  });

  it('selects the posting capability for transfer paths', async () => {
    const { transport, calls } = stubTransport({ strict: true });
    const client = new LedgerClient(config, transport);
    await client
      .request(
        '/internal/customer-transfers',
        'POST',
        customerAccountListSchema,
        request,
        { body: { amountMinor: '100' } },
      )
      .catch(() => undefined);
    // Reads and postings are separate capabilities so one token cannot do both.
    expect(calls[0]?.capability).toBe('ledger.postings');
  });

  it('surfaces an upstream error status without inventing a success', async () => {
    const { transport } = stubTransport({
      strict: true,
      respond: () => ({
        status: 404,
        body: { error: { code: 'ACCOUNT_NOT_FOUND' } },
      }),
    });
    const client = new LedgerClient(config, transport);

    await expect(
      client.request(
        '/internal/customer-accounts/acc_missing',
        'GET',
        customerAccountListSchema,
        request,
      ),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('treats a contract-violating response as an outage', async () => {
    const { transport } = stubTransport({
      strict: true,
      respond: () => ({ status: 200, body: { unexpected: true } }),
    });
    const client = new LedgerClient(config, transport);

    await expect(
      client.request(
        '/internal/customers/cus_1/accounts',
        'GET',
        customerAccountListSchema,
        request,
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'LEDGER_UNAVAILABLE' } },
    });
  });

  it('does not fall back to plaintext when strict and the router is down', async () => {
    const { transport } = stubTransport({
      strict: true,
      respond: () => {
        throw new SabclError('SABCL_RECIPIENT_UNAVAILABLE');
      },
    });
    const client = new LedgerClient(config, transport);

    await expect(
      client.request(
        '/internal/customers/cus_1/accounts',
        'GET',
        customerAccountListSchema,
        request,
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'LEDGER_UNAVAILABLE' } },
    });
    // The critical assertion: no direct call was attempted. A downgrade here
    // would send the customer identifier over the plaintext internal path.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('falls back only in compatible mode, which is refused in production', async () => {
    const { transport } = stubTransport({
      strict: false,
      respond: () => {
        throw new SabclError('SABCL_RECIPIENT_UNAVAILABLE');
      },
    });
    globalThis.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ accounts: [] }),
      }),
    ) as unknown as typeof fetch;
    const client = new LedgerClient(config, transport);

    await expect(
      client.request(
        '/internal/customers/cus_1/accounts',
        'GET',
        customerAccountListSchema,
        request,
      ),
    ).resolves.toEqual({ accounts: [] });
    expect(globalThis.fetch).toHaveBeenCalled();
  });
});
