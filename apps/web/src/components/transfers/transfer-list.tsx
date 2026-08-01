'use client';
import { formatMoney, type TransferListResponse } from '@aegis/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { transfersClient } from '@/lib/api/transfers-client';
export function TransferList() {
  const [data, setData] = useState<TransferListResponse>();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  async function load(cursor?: string) {
    try {
      setLoading(true);
      const query = new URLSearchParams();
      if (cursor) query.set('cursor', cursor);
      const next = await transfersClient.list(query);
      setData((current) =>
        current
          ? {
              transfers: [
                ...current.transfers,
                ...next.transfers.filter(
                  (item) =>
                    !current.transfers.some((known) => known.id === item.id),
                ),
              ],
              nextCursor: next.nextCursor,
            }
          : next,
      );
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, []);
  if (error && !data)
    return <p role="alert">Transfer history is temporarily unavailable.</p>;
  return (
    <section
      className="transfer-list"
      aria-labelledby="transfer-history-heading"
    >
      <div className="workspace-title">
        <div>
          <p className="eyebrow">Transfers</p>
          <h1 id="transfer-history-heading">Transfer history</h1>
        </div>
        <Link href="/app/transfers/new" className="button button-primary">
          Send money
        </Link>
      </div>
      {!data?.transfers.length ? (
        <p role="status">No transfers yet.</p>
      ) : (
        <ol>
          {data.transfers.map((transfer) => (
            <li key={transfer.id}>
              <Link href={`/app/transfers/${transfer.id}`}>
                <span>
                  <strong>
                    {transfer.direction === 'SENT' ? 'Sent' : 'Received'} ·{' '}
                    {transfer.status}
                  </strong>
                  <small>{transfer.counterpartyMaskedReference}</small>
                  <time dateTime={transfer.createdAt}>
                    {new Date(transfer.createdAt).toLocaleString()}
                  </time>
                </span>
                <strong
                  className={
                    transfer.direction === 'SENT'
                      ? 'amount-negative'
                      : 'amount-positive'
                  }
                >
                  {transfer.direction === 'SENT' ? '−' : '+'}
                  {formatMoney(transfer.amount)}
                </strong>
              </Link>
            </li>
          ))}
        </ol>
      )}
      {error ? (
        <p role="alert">
          Previously loaded transfers remain available. Try again later.
        </p>
      ) : null}
      {data?.nextCursor ? (
        <button
          type="button"
          className="button button-secondary"
          disabled={loading}
          onClick={() => void load(data.nextCursor!)}
        >
          Load more
        </button>
      ) : null}
    </section>
  );
}
