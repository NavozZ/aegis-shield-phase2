import type {
  CustomerTransactionSummary,
  TransactionHistoryResponse,
} from '@aegis/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dictionaries } from '@/lib/i18n/dictionaries';
import { renderWithLanguage } from '@/test/render';
import { TransactionHistory } from './transaction-history';

const replace = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => '/app/accounts/account-id',
  useSearchParams: () => new URLSearchParams(),
}));

const accountId = '33333333-3333-4333-8333-333333333333';
function transaction(
  id: string,
  direction: 'INCOMING' | 'OUTGOING',
  category: 'FUNDING' | 'ADJUSTMENT' | 'OTHER',
  amount: string,
): CustomerTransactionSummary {
  return {
    id,
    displayReference: `AEGIS-TXN-${id.slice(0, 4).toUpperCase()}-${id.slice(4, 8).toUpperCase()}-${id.slice(9, 13).toUpperCase()}`,
    accountId,
    direction,
    category,
    status: 'POSTED',
    amount: { currency: 'LKR', minorUnits: amount },
    balanceAfter: { currency: 'LKR', minorUnits: '9007199254740993' },
    effectiveAt: '2026-08-01T10:00:00.000Z',
    postedAt: '2026-08-01T10:01:00.000Z',
  };
}
const incoming = transaction(
  '11111111-1111-4111-8111-111111111111',
  'INCOMING',
  'FUNDING',
  '100',
);
const outgoing = transaction(
  '22222222-2222-4222-8222-222222222222',
  'OUTGOING',
  'ADJUSTMENT',
  '25',
);

function renderHistory(
  value: TransactionHistoryResponse,
  language: 'EN' | 'SI' | 'TA' = 'EN',
) {
  return renderWithLanguage(
    <TransactionHistory accountId={accountId} initial={value} />,
    language,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('TransactionHistory', () => {
  it('renders non-color direction labels, translated categories, signs and safe detail links', () => {
    renderHistory({ transactions: [incoming, outgoing], nextCursor: null });
    expect(screen.getAllByText('Incoming')).toHaveLength(2);
    expect(screen.getAllByText('Outgoing')).toHaveLength(2);
    expect(screen.getAllByText(/Funding/u).length).toBeGreaterThan(1);
    expect(screen.getAllByText(/Adjustment/u).length).toBeGreaterThan(1);
    expect(screen.getByText('+LKR 1.00')).toBeInTheDocument();
    expect(screen.getByText('−LKR 0.25')).toBeInTheDocument();
    expect(screen.getAllByRole('link')[0]).toHaveAttribute(
      'href',
      expect.stringContaining(incoming.id),
    );
    expect(screen.getAllByRole('time')).toHaveLength(2);
  });

  it('renders exact large balances and an empty result accessibly', () => {
    const { unmount } = renderHistory({
      transactions: [incoming],
      nextCursor: null,
    });
    expect(screen.getByText('+LKR 1.00')).toBeInTheDocument();
    unmount();
    renderHistory({ transactions: [], nextCursor: null });
    expect(screen.getByRole('status')).toHaveTextContent('No transactions yet');
  });

  it('applies and clears safe query filters', async () => {
    renderHistory({ transactions: [], nextCursor: null });
    await userEvent.selectOptions(
      screen.getByLabelText('Direction'),
      'INCOMING',
    );
    expect(replace).toHaveBeenCalledWith(
      '/app/accounts/account-id?direction=INCOMING',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Clear filters' }),
    );
    expect(replace).toHaveBeenCalledWith('/app/accounts/account-id');
  });

  it('loads another page, retains rows and removes duplicates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            transactions: [incoming, outgoing],
            nextCursor: null,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    renderHistory({ transactions: [incoming], nextCursor: 'cursor-value' });
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() =>
      expect(screen.getAllByRole('listitem')).toHaveLength(2),
    );
    expect(screen.getAllByText('Incoming')).toHaveLength(2);
    expect(screen.getAllByText('Outgoing')).toHaveLength(2);
  });

  it('retains existing rows and announces a load-more failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: 'LEDGER_UNAVAILABLE' } }),
            { status: 503, headers: { 'content-type': 'application/json' } },
          ),
        ),
    );
    renderHistory({ transactions: [incoming], nextCursor: 'cursor-value' });
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'History unavailable',
    );
    expect(screen.getAllByText('Incoming')).toHaveLength(2);
  });

  it.each(['EN', 'SI', 'TA'] as const)(
    'translates every transaction control in %s',
    (language) => {
      renderHistory({ transactions: [incoming], nextCursor: 'next' }, language);
      const dictionary = dictionaries[language];
      expect(
        screen.getByRole('heading', { name: dictionary.transactionHistory }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText(dictionary.direction)).toBeInTheDocument();
      expect(screen.getByLabelText(dictionary.category)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: dictionary.loadMore }),
      ).toBeInTheDocument();
      expect(screen.getAllByText(dictionary.incoming)).toHaveLength(2);
      expect(
        screen.getAllByText(new RegExp(dictionary.funding, 'u')).length,
      ).toBeGreaterThan(1);
    },
  );
});
