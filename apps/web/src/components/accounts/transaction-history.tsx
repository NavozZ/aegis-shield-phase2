'use client';

import { formatMoney, type TransactionHistoryResponse } from '@aegis/contracts';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

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
  function set(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete('cursor');
    router.replace(`${path}?${next}`);
  }
  return (
    <section className="transaction-history" aria-labelledby="history-heading">
      <div className="workspace-title">
        <div>
          <p className="eyebrow">Immutable ledger</p>
          <h2 id="history-heading">Transaction history</h2>
        </div>
      </div>
      <div className="history-filters" aria-label="Transaction filters">
        <label>
          Direction
          <select
            value={params.get('direction') || ''}
            onChange={(event) => set('direction', event.target.value)}
          >
            <option value="">All directions</option>
            <option value="INCOMING">Incoming</option>
            <option value="OUTGOING">Outgoing</option>
          </select>
        </label>
        <label>
          Category
          <select
            value={params.get('category') || ''}
            onChange={(event) => set('category', event.target.value)}
          >
            <option value="">All categories</option>
            <option value="FUNDING">Funding</option>
            <option value="ADJUSTMENT">Adjustment</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
      </div>
      {initial.transactions.length ? (
        <ol className="transaction-list">
          {initial.transactions.map((item) => (
            <li key={item.id}>
              <Link href={`/app/accounts/${accountId}/transactions/${item.id}`}>
                <span>
                  <strong>
                    {item.direction === 'INCOMING' ? 'Incoming' : 'Outgoing'}
                  </strong>
                  <small>
                    {item.category} · {item.displayReference}
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
        <p role="status">No posted activity matches these filters.</p>
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
          Load more
        </button>
      ) : null}
    </section>
  );
}
