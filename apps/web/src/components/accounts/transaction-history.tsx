'use client';

import { formatMoney, type TransactionHistoryResponse } from '@aegis/contracts';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/language-provider';

export function TransactionHistory({
  accountId,
  initial,
}: {
  accountId: string;
  initial: TransactionHistoryResponse;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const { dictionary } = useLanguage();
  function set(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete('cursor');
    router.replace(`${path}?${next}`);
  }
  const label = (value: string) =>
    value === 'INCOMING'
      ? dictionary.incoming
      : value === 'OUTGOING'
        ? dictionary.outgoing
        : value === 'FUNDING'
          ? dictionary.funding
          : value === 'ADJUSTMENT'
            ? dictionary.adjustment
            : dictionary.other;
  function clear() {
    router.replace(path);
  }
  return (
    <section className="transaction-history" aria-labelledby="history-heading">
      <div className="workspace-title">
        <div>
          <p className="eyebrow">{dictionary.accounts}</p>
          <h2 id="history-heading">{dictionary.transactionHistory}</h2>
        </div>
      </div>
      <div
        className="history-filters"
        aria-label={dictionary.transactionHistory}
      >
        <label>
          {dictionary.direction}
          <select
            value={params.get('direction') || ''}
            onChange={(event) => set('direction', event.target.value)}
          >
            <option value="">{dictionary.direction}</option>
            <option value="INCOMING">{dictionary.incoming}</option>
            <option value="OUTGOING">{dictionary.outgoing}</option>
          </select>
        </label>
        <label>
          {dictionary.category}
          <select
            value={params.get('category') || ''}
            onChange={(event) => set('category', event.target.value)}
          >
            <option value="">{dictionary.category}</option>
            <option value="FUNDING">{dictionary.funding}</option>
            <option value="ADJUSTMENT">{dictionary.adjustment}</option>
            <option value="OTHER">{dictionary.other}</option>
          </select>
        </label>
        <label>
          {dictionary.dateFrom}
          <input
            type="datetime-local"
            aria-label={dictionary.dateFrom}
            onChange={(event) =>
              set(
                'dateFrom',
                event.target.value
                  ? new Date(event.target.value).toISOString()
                  : '',
              )
            }
          />
        </label>
        <label>
          {dictionary.dateTo}
          <input
            type="datetime-local"
            aria-label={dictionary.dateTo}
            onChange={(event) =>
              set(
                'dateTo',
                event.target.value
                  ? new Date(event.target.value).toISOString()
                  : '',
              )
            }
          />
        </label>
        <button
          type="button"
          className="button button-secondary"
          onClick={clear}
        >
          {dictionary.clearFilters}
        </button>
      </div>
      {initial.transactions.length ? (
        <ol className="transaction-list">
          {initial.transactions.map((item) => (
            <li key={item.id}>
              <Link href={`/app/accounts/${accountId}/transactions/${item.id}`}>
                <span>
                  <strong>{label(item.direction)}</strong>
                  <small>
                    {label(item.category)} · {item.displayReference}
                  </small>
                </span>
                <span
                  className={
                    item.direction === 'INCOMING'
                      ? 'amount-positive'
                      : 'amount-negative'
                  }
                >
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
      ) : (
        <p role="status">{dictionary.noTransactionsYet}</p>
      )}
      {initial.nextCursor ? (
        <button
          className="button button-secondary"
          onClick={() => {
            const next = new URLSearchParams(params);
            next.set('cursor', initial.nextCursor!);
            router.push(`${path}?${next}`);
          }}
        >
          {dictionary.loadMore}
        </button>
      ) : null}
    </section>
  );
}
