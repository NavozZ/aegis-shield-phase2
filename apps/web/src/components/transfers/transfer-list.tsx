'use client';
import { formatMoney, type TransferListResponse } from '@aegis/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { transfersClient } from '@/lib/api/transfers-client';
import { useLanguage } from '@/lib/i18n/language-provider';
import { transferCopy } from './transfer-copy';
export function TransferList() {
  const { language } = useLanguage();
  const copy = transferCopy[language];
  const [data, setData] = useState<TransferListResponse>();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState('');
  const [filters, setFilters] = useState({ direction: '', status: '' });
  async function load(cursor?: string, replace = false) {
    try {
      setLoading(true);
      const query = new URLSearchParams();
      if (cursor) query.set('cursor', cursor);
      if (filters.direction) query.set('direction', filters.direction);
      if (filters.status) query.set('status', filters.status);
      const next = await transfersClient.list(query);
      setData((current) =>
        current && !replace
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
    void Promise.resolve().then(() => load(undefined, true));
    // `filters` is the submitted immutable snapshot; draft select changes do
    // not issue requests until the customer applies them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);
  if (error && !data) return <p role="alert">{copy.unavailable}</p>;
  return (
    <section
      className="transfer-list"
      aria-labelledby="transfer-history-heading"
    >
      <div className="workspace-title">
        <div>
          <p className="eyebrow">{copy.transfers}</p>
          <h1 id="transfer-history-heading">{copy.history}</h1>
        </div>
        <Link href="/app/transfers/new" className="button button-primary">
          {copy.sendMoney}
        </Link>
      </div>
      <div className="transaction-filters">
        <label>
          <span>{copy.direction}</span>
          <select
            value={direction}
            onChange={(event) => setDirection(event.target.value)}
          >
            <option value="">{copy.allDirections}</option>
            <option value="SENT">{copy.sent}</option>
            <option value="RECEIVED">{copy.received}</option>
          </select>
        </label>
        <label>
          <span>{copy.status}</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">{copy.allStatuses}</option>
            <option value="PROCESSING">PROCESSING</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="FAILED">FAILED</option>
            <option value="REQUIRES_REVIEW">REQUIRES_REVIEW</option>
          </select>
        </label>
        <button
          type="button"
          className="button button-secondary"
          disabled={loading}
          onClick={() => {
            setError(false);
            setFilters({ direction, status });
          }}
        >
          {copy.applyFilters}
        </button>
      </div>
      {!data?.transfers.length ? (
        <p role="status">{copy.none}</p>
      ) : (
        <ol>
          {data.transfers.map((transfer) => (
            <li key={transfer.id}>
              <Link href={`/app/transfers/${transfer.id}`}>
                <span>
                  <strong>
                    {transfer.direction === 'SENT' ? copy.sent : copy.received}{' '}
                    · {transfer.status}
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
      {error ? <p role="alert">{copy.retained}</p> : null}
      {data?.nextCursor ? (
        <button
          type="button"
          className="button button-secondary"
          disabled={loading}
          onClick={() => void load(data.nextCursor!)}
        >
          {copy.loadMore}
        </button>
      ) : null}
    </section>
  );
}
