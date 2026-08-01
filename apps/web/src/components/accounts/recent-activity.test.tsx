import type { CustomerTransactionSummary } from '@aegis/contracts';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { dictionaries } from '@/lib/i18n/dictionaries';
import { renderWithLanguage } from '@/test/render';
import { RecentActivity } from './recent-activity';

const accountId = '33333333-3333-4333-8333-333333333333';
const activity: CustomerTransactionSummary[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    displayReference: 'AEGIS-TXN-1111-1111-1111',
    accountId,
    direction: 'INCOMING',
    category: 'FUNDING',
    status: 'POSTED',
    amount: { currency: 'LKR', minorUnits: '9007199254740993' },
    balanceAfter: { currency: 'LKR', minorUnits: '9007199254740993' },
    effectiveAt: '2026-08-01T10:00:00.000Z',
    postedAt: '2026-08-01T10:01:00.000Z',
  },
];

describe('RecentActivity', () => {
  it('shows exact recent activity and account-history navigation', () => {
    renderWithLanguage(
      <RecentActivity accountId={accountId} transactions={activity} />,
    );
    expect(screen.getAllByText('Incoming')).toHaveLength(1);
    expect(screen.getByText('+LKR 90,071,992,547,409.93')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'View all transactions' }),
    ).toHaveAttribute('href', `/app/accounts/${accountId}`);
  });

  it('distinguishes zero activity from a partial history failure', () => {
    const { unmount } = renderWithLanguage(
      <RecentActivity accountId={accountId} transactions={[]} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('No transactions yet');
    unmount();
    renderWithLanguage(
      <RecentActivity accountId={accountId} transactions={[]} unavailable />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('History unavailable');
  });

  it.each(['SI', 'TA'] as const)(
    'translates dashboard activity labels in %s',
    (language) => {
      renderWithLanguage(
        <RecentActivity accountId={accountId} transactions={activity} />,
        language,
      );
      expect(
        screen.getByRole('heading', {
          name: dictionaries[language].recentActivity,
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(dictionaries[language].incoming),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', {
          name: dictionaries[language].viewAllTransactions,
        }),
      ).toBeInTheDocument();
    },
  );
});
