import { formatMoney } from '@aegis/contracts';
import Link from 'next/link';
import { PrintRecordButton } from '@/components/accounts/print-record-button';
import { getServerTransaction } from '@/lib/accounts/server-transactions';

export default async function TransactionPage({
  params,
}: {
  params: Promise<{ accountId: string; transactionId: string }>;
}) {
  const { accountId, transactionId } = await params;
  const state = await getServerTransaction(accountId, transactionId);
  if (state.status !== 'ready')
    return <p role="status">This transaction record is unavailable.</p>;
  const item = state.value;
  return (
    <article className="receipt">
      <Link className="no-print" href={`/app/accounts/${accountId}`}>
        ← Back to history
      </Link>
      <header>
        <p className="eyebrow">AEGIS Shield · prototype record</p>
        <h1>Transaction record</h1>
      </header>
      <dl>
        <div>
          <dt>Reference</dt>
          <dd>{item.displayReference}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{item.status}</dd>
        </div>
        <div>
          <dt>Direction</dt>
          <dd>{item.direction}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{item.category}</dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>{formatMoney(item.amount)}</dd>
        </div>
        <div>
          <dt>Balance after</dt>
          <dd>{formatMoney(item.balanceAfter)}</dd>
        </div>
        <div>
          <dt>Effective</dt>
          <dd>
            <time dateTime={item.effectiveAt}>
              {new Date(item.effectiveAt).toLocaleString()}
            </time>
          </dd>
        </div>
        <div>
          <dt>Posted</dt>
          <dd>
            <time dateTime={item.postedAt}>
              {new Date(item.postedAt).toLocaleString()}
            </time>
          </dd>
        </div>
        <div>
          <dt>Account</dt>
          <dd>
            {item.maskedAccountReference} · {item.productType}
          </dd>
        </div>
      </dl>
      <PrintRecordButton />
      <p>
        This is a synthetic prototype record, not proof of payment or a
        financial instrument.
      </p>
    </article>
  );
}
