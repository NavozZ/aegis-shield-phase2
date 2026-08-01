'use client';
import { formatMoney, type TransferDetail } from '@aegis/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PrintRecordButton } from '@/components/accounts/print-record-button';
import { transfersClient } from '@/lib/api/transfers-client';
import { useLanguage } from '@/lib/i18n/language-provider';
import { transferCopy } from './transfer-copy';

export const TRANSFER_POLL_INTERVAL_MS = 1_000;
export const TRANSFER_MAX_POLL_ATTEMPTS = 30;
export function TransferRecord({ id }: { id: string }) {
  const { language } = useLanguage();
  const copy = transferCopy[language];
  const [transfer, setTransfer] = useState<TransferDetail>();
  const [error, setError] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    async function poll() {
      try {
        const next = await transfersClient.detail(id);
        if (cancelled) return;
        setTransfer(next);
        if (next.status === 'PROCESSING') {
          attempts += 1;
          if (attempts >= TRANSFER_MAX_POLL_ATTEMPTS) setTimedOut(true);
          else timer = setTimeout(() => void poll(), TRANSFER_POLL_INTERVAL_MS);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);
  if (error) return <p role="status">{copy.notFound}</p>;
  if (!transfer)
    return (
      <p role="status" aria-live="polite">
        {copy.processing}
      </p>
    );
  return (
    <article className="receipt">
      <Link className="no-print" href="/app/transfers">
        ← {copy.back}
      </Link>
      <header>
        <p className="eyebrow">AEGIS Shield</p>
        <h1>{copy.record}</h1>
      </header>
      <dl>
        <div>
          <dt>{copy.reference}</dt>
          <dd>{transfer.displayReference}</dd>
        </div>
        <div>
          <dt>{copy.direction}</dt>
          <dd>{transfer.direction}</dd>
        </div>
        <div>
          <dt>{copy.status}</dt>
          <dd>{transfer.status}</dd>
        </div>
        <div>
          <dt>{copy.amount}</dt>
          <dd>{formatMoney(transfer.amount)}</dd>
        </div>
        <div>
          <dt>{copy.counterparty}</dt>
          <dd>{transfer.counterpartyMaskedReference}</dd>
        </div>
        <div>
          <dt>{copy.account}</dt>
          <dd>{transfer.ownMaskedReference}</dd>
        </div>
        <div>
          <dt>{copy.created}</dt>
          <dd>{new Date(transfer.createdAt).toLocaleString()}</dd>
        </div>
        {transfer.completedAt ? (
          <div>
            <dt>{copy.completed}</dt>
            <dd>{new Date(transfer.completedAt).toLocaleString()}</dd>
          </div>
        ) : null}
        {transfer.balanceAfter ? (
          <div>
            <dt>{copy.resultingBalance}</dt>
            <dd>{formatMoney(transfer.balanceAfter)}</dd>
          </div>
        ) : null}
      </dl>
      {timedOut ? <p role="alert">{copy.processingTimeout}</p> : null}
      <PrintRecordButton />
      <p>{copy.disclaimer}</p>
    </article>
  );
}
