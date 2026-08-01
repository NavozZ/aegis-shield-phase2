'use client';

import { formatMoney, type CustomerTransactionSummary } from '@aegis/contracts';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/language-provider';

export function RecentActivity({
  accountId,
  transactions,
  unavailable = false,
}: {
  accountId: string;
  transactions: CustomerTransactionSummary[];
  unavailable?: boolean;
}) {
  const { dictionary } = useLanguage();
  return (
    <section
      className="transaction-history"
      aria-labelledby="recent-activity-heading"
    >
      <h2 id="recent-activity-heading">{dictionary.recentActivity}</h2>
      {unavailable ? (
        <p role="status">{dictionary.historyUnavailable}</p>
      ) : transactions.length === 0 ? (
        <p role="status">{dictionary.noTransactionsYet}</p>
      ) : (
        <ol className="transaction-list">
          {transactions.slice(0, 5).map((item) => (
            <li key={item.id}>
              <Link href={`/app/accounts/${accountId}/transactions/${item.id}`}>
                <strong>
                  {item.direction === 'INCOMING'
                    ? dictionary.incoming
                    : dictionary.outgoing}
                </strong>
                <span>
                  {item.direction === 'INCOMING' ? '+' : '−'}
                  {formatMoney(item.amount)}
                </span>
                <time dateTime={item.postedAt}>
                  {new Date(item.postedAt).toLocaleString()}
                </time>
              </Link>
            </li>
          ))}
        </ol>
      )}
      <Link href={`/app/accounts/${accountId}`}>
        {dictionary.viewAllTransactions}
      </Link>
    </section>
  );
}
