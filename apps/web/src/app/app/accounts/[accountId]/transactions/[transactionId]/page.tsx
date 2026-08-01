import { formatMoney } from '@aegis/contracts';
import Link from 'next/link';
import { PrintRecordButton } from '@/components/accounts/print-record-button';
import { getServerTransaction } from '@/lib/accounts/server-transactions';
import { getServerDictionary } from '@/lib/i18n/server';

export default async function TransactionPage({
  params,
}: {
  params: Promise<{ accountId: string; transactionId: string }>;
}) {
  const { accountId, transactionId } = await params;
  const [state, dictionary] = await Promise.all([
    getServerTransaction(accountId, transactionId),
    getServerDictionary(),
  ]);
  if (state.status !== 'ready')
    return (
      <p role="status">
        {state.status === 'not-found'
          ? dictionary.transactionNotFound
          : dictionary.transactionUnavailable}
      </p>
    );
  const item = state.value;
  const direction =
    item.direction === 'INCOMING' ? dictionary.incoming : dictionary.outgoing;
  const category =
    item.category === 'FUNDING'
      ? dictionary.funding
      : item.category === 'ADJUSTMENT'
        ? dictionary.adjustment
        : dictionary.other;
  return (
    <article className="receipt">
      <Link className="no-print" href={`/app/accounts/${accountId}`}>
        ← {dictionary.backToTransactions}
      </Link>
      <header>
        <p className="eyebrow">AEGIS Shield</p>
        <h1>{dictionary.prototypeTransactionRecord}</h1>
      </header>
      <dl>
        <div>
          <dt>{dictionary.transactionReference}</dt>
          <dd>{item.displayReference}</dd>
        </div>
        <div>
          <dt>{dictionary.accountStatus}</dt>
          <dd>{dictionary.posted}</dd>
        </div>
        <div>
          <dt>{dictionary.direction}</dt>
          <dd>{direction}</dd>
        </div>
        <div>
          <dt>{dictionary.category}</dt>
          <dd>{category}</dd>
        </div>
        <div>
          <dt>{dictionary.amount}</dt>
          <dd>{formatMoney(item.amount)}</dd>
        </div>
        <div>
          <dt>{dictionary.balanceAfter}</dt>
          <dd>{formatMoney(item.balanceAfter)}</dd>
        </div>
        <div>
          <dt>{dictionary.effectiveDate}</dt>
          <dd>
            <time dateTime={item.effectiveAt}>
              {new Date(item.effectiveAt).toLocaleString()}
            </time>
          </dd>
        </div>
        <div>
          <dt>{dictionary.postedDate}</dt>
          <dd>
            <time dateTime={item.postedAt}>
              {new Date(item.postedAt).toLocaleString()}
            </time>
          </dd>
        </div>
        <div>
          <dt>{dictionary.accountDetails}</dt>
          <dd>
            {item.maskedAccountReference} · {item.productType}
          </dd>
        </div>
      </dl>
      <PrintRecordButton />
      <p>{dictionary.transactionDisclaimer}</p>
    </article>
  );
}
