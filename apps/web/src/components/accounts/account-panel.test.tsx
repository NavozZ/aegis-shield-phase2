import type { CustomerAccountDetail } from '@aegis/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithLanguage } from '@/test/render';
import { dictionaries } from '@/lib/i18n/dictionaries';
import { AccountPanel } from './account-panel';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn() }),
}));

const account: CustomerAccountDetail = {
  id: '22222222-2222-4222-8222-222222222222',
  maskedReference: 'AEGIS-****-****-8T3W',
  productType: 'TIER0_WALLET',
  status: 'ACTIVE',
  currency: 'LKR',
  createdAt: '2026-07-31T10:00:00.000Z',
  balance: { currency: 'LKR', minorUnits: '0' },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  document.cookie = 'aegis_csrf=csrf-token-value; Path=/';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.cookie = 'aegis_csrf=; Max-Age=0; Path=/';
});

describe('account panel without an account', () => {
  it('explains the Tier-0 wallet and offers creation', () => {
    renderWithLanguage(<AccountPanel initialAccount={null} />);

    expect(screen.getByText('No account created yet')).toBeInTheDocument();
    expect(screen.getByText(/Tier-0 wallet is a basic/u)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create Tier-0 account' }),
    ).toBeInTheDocument();
  });

  it('shows the zero-funds prototype notice', () => {
    renderWithLanguage(<AccountPanel initialAccount={null} />);

    expect(
      screen.getByText(/A new account opens with a zero balance/u),
    ).toBeInTheDocument();
  });

  it('creates an account with CSRF and a generated idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(account, 201));
    vi.stubGlobal('fetch', fetchMock);
    renderWithLanguage(<AccountPanel initialAccount={null} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Create Tier-0 account' }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain('/api/v1/accounts/default');
    expect(init.method).toBe('POST');
    const headers = init.headers as Headers;
    expect(headers.get('x-csrf-token')).toBe('csrf-token-value');
    expect(headers.get('idempotency-key')).toMatch(
      /^acct-default-[0-9a-f-]{36}$/u,
    );
    expect(init.credentials).toBe('include');
  });

  it('renders the created account and refreshes server data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(account, 201)),
    );
    renderWithLanguage(<AccountPanel initialAccount={null} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Create Tier-0 account' }),
    );

    expect(await screen.findByText('AEGIS-****-****-8T3W')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it('prevents a duplicate submission while the request is in flight', async () => {
    let release: (value: Response) => void = () => undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolveFetch) => {
          release = resolveFetch;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithLanguage(<AccountPanel initialAccount={null} />);

    const button = screen.getByRole('button', {
      name: 'Create Tier-0 account',
    });
    await userEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    await userEvent.click(button);
    await userEvent.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute('aria-busy', 'true');
    release(jsonResponse(account, 201));
    await screen.findByText('AEGIS-****-****-8T3W');
  });

  it('reuses the same idempotency key when a failed attempt is retried', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 'LEDGER_UNAVAILABLE' } }, 503),
      )
      .mockResolvedValueOnce(jsonResponse(account, 201));
    vi.stubGlobal('fetch', fetchMock);
    renderWithLanguage(<AccountPanel initialAccount={null} />);

    const button = screen.getByRole('button', {
      name: 'Create Tier-0 account',
    });
    await userEvent.click(button);
    await screen.findByRole('alert');
    await userEvent.click(button);
    await screen.findByText('AEGIS-****-****-8T3W');

    const firstKey = (
      (fetchMock.mock.calls[0] as [URL, RequestInit])[1].headers as Headers
    ).get('idempotency-key');
    const secondKey = (
      (fetchMock.mock.calls[1] as [URL, RequestInit])[1].headers as Headers
    ).get('idempotency-key');
    expect(firstKey).toBe(secondKey);
  });

  it('announces a session expiry accessibly', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { code: 'UNAUTHENTICATED' } }, 401),
        ),
    );
    renderWithLanguage(<AccountPanel initialAccount={null} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Create Tier-0 account' }),
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Your session expired. Please sign in again.',
    );
  });

  it('reports a service outage without creating an account', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { code: 'LEDGER_UNAVAILABLE' } }, 503),
        ),
    );
    renderWithLanguage(<AccountPanel initialAccount={null} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Create Tier-0 account' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /temporarily unavailable/u,
    );
    expect(screen.queryByText('AEGIS-****-****-8T3W')).not.toBeInTheDocument();
  });
});

describe('account panel with an account', () => {
  it('renders API-derived values and formats zero as LKR 0.00', () => {
    renderWithLanguage(<AccountPanel initialAccount={account} />);

    expect(screen.getByText('AEGIS-****-****-8T3W')).toBeInTheDocument();
    expect(screen.getByText('Tier-0 wallet')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('LKR')).toBeInTheDocument();
    expect(screen.getByText('LKR 0.00')).toBeInTheDocument();
    expect(
      screen.getByText('Transaction history comes in Prompt 06.'),
    ).toBeInTheDocument();
  });

  it('formats a balance beyond safe integer precision exactly', () => {
    renderWithLanguage(
      <AccountPanel
        initialAccount={{
          ...account,
          balance: { currency: 'LKR', minorUnits: '9007199254740993' },
        }}
      />,
    );

    expect(screen.getByText('LKR 90,071,992,547,409.93')).toBeInTheDocument();
  });

  it('never renders the full account reference or an internal identifier', () => {
    const { container } = renderWithLanguage(
      <AccountPanel initialAccount={account} />,
    );

    expect(container.textContent).not.toContain(account.id);
    expect(container.textContent).not.toMatch(/AEGIS-[A-Z0-9]{4}-[A-Z0-9]{4}/u);
  });

  it('offers no creation button once an account exists', () => {
    renderWithLanguage(<AccountPanel initialAccount={account} />);

    expect(
      screen.queryByRole('button', { name: 'Create Tier-0 account' }),
    ).not.toBeInTheDocument();
  });

  it('invents no funds, interest or transaction rows', () => {
    const { container } = renderWithLanguage(
      <AccountPanel initialAccount={account} />,
    );

    // The only monetary amount rendered is the real zero balance.
    expect(container.textContent?.match(/LKR\s[\d,]+\.\d{2}/gu)).toEqual([
      'LKR 0.00',
    ]);
    expect(container.textContent).not.toMatch(/interest/iu);
    expect(container.querySelector('table')).toBeNull();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

describe('account panel translations', () => {
  it.each(['SI', 'TA'] as const)(
    'renders the empty state in %s',
    (language) => {
      renderWithLanguage(<AccountPanel initialAccount={null} />, language);

      expect(
        screen.getByText(dictionaries[language].noAccountYet),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: dictionaries[language].createTierZeroAccount,
        }),
      ).toBeInTheDocument();
    },
  );

  it.each(['EN', 'SI', 'TA'] as const)(
    'renders the account summary labels in %s',
    (language) => {
      renderWithLanguage(<AccountPanel initialAccount={account} />, language);

      expect(
        screen.getByText(dictionaries[language].accountBalance),
      ).toBeInTheDocument();
      expect(
        screen.getByText(dictionaries[language].historyInPrompt06),
      ).toBeInTheDocument();
      // The formatted amount is locale-independent in this prototype.
      expect(screen.getByText('LKR 0.00')).toBeInTheDocument();
    },
  );
});

describe('account panel when the ledger is unavailable', () => {
  it('reports the outage instead of claiming there is no account', () => {
    renderWithLanguage(<AccountPanel initialAccount={null} unavailable />);

    expect(screen.getByRole('status')).toHaveTextContent(
      /temporarily unavailable/u,
    );
    expect(
      screen.queryByText('No account created yet'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Create Tier-0 account' }),
    ).not.toBeInTheDocument();
  });
});
