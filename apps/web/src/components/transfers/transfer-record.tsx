'use client';
import { formatMoney, type TransferDetail } from '@aegis/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PrintRecordButton } from '@/components/accounts/print-record-button';
import { transfersClient } from '@/lib/api/transfers-client';
export function TransferRecord({ id }: { id: string }) {
  const [transfer, setTransfer] = useState<TransferDetail>();
  const [error, setError] = useState(false);
  useEffect(() => {
    void transfersClient
      .detail(id)
      .then(setTransfer)
      .catch(() => setError(true));
  }, [id]);
  if (error) return <p role="status">Transfer not found.</p>;
  if (!transfer)
    return (
      <p role="status" aria-live="polite">
        Transfer processing…
      </p>
    );
  return (
    <article className="receipt">
      <Link className="no-print" href="/app/transfers">
        ← Back to transfers
      </Link>
      <header>
        <p className="eyebrow">AEGIS Shield</p>
        <h1>Prototype transfer record</h1>
      </header>
      <dl>
        <div>
          <dt>Transfer reference</dt>
          <dd>{transfer.displayReference}</dd>
        </div>
        <div>
          <dt>Direction</dt>
          <dd>{transfer.direction}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{transfer.status}</dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>{formatMoney(transfer.amount)}</dd>
        </div>
        <div>
          <dt>Counterparty</dt>
          <dd>{transfer.counterpartyMaskedReference}</dd>
        </div>
        <div>
          <dt>Account</dt>
          <dd>{transfer.ownMaskedReference}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{new Date(transfer.createdAt).toLocaleString()}</dd>
        </div>
        {transfer.completedAt ? (
          <div>
            <dt>Completed</dt>
            <dd>{new Date(transfer.completedAt).toLocaleString()}</dd>
          </div>
        ) : null}
        {transfer.balanceAfter ? (
          <div>
            <dt>Resulting balance</dt>
            <dd>{formatMoney(transfer.balanceAfter)}</dd>
          </div>
        ) : null}
      </dl>
      <PrintRecordButton />
      <p>
        This is a synthetic prototype record, not proof of payment or a
        financial instrument.
      </p>
    </article>
  );
}
