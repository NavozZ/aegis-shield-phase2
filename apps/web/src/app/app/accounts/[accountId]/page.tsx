import Link from 'next/link';
import { TransactionHistory } from '@/components/accounts/transaction-history';
import { getServerAccount } from '@/lib/accounts/server-accounts';
import { getServerTransactions } from '@/lib/accounts/server-transactions';

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { accountId } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams))
    if (
      typeof value === 'string' &&
      [
        'direction',
        'category',
        'dateFrom',
        'dateTo',
        'pageSize',
        'cursor',
      ].includes(key)
    )
      query.set(key, value);
  const [accountState, transactions] = await Promise.all([
    getServerAccount(),
    getServerTransactions(accountId, query.size ? `?${query}` : ''),
  ]);
  if (
    accountState.status !== 'ready' ||
    !accountState.account ||
    accountState.account.id !== accountId ||
    transactions.status !== 'ready'
  )
    return <p role="status">Account history is unavailable right now.</p>;
  return (
    <div className="workspace-content">
      <Link href="/app">← Secure workspace</Link>
      <section className="account-panel">
        <h1>{accountState.account.maskedReference}</h1>
        <p>
          {accountState.account.productType} · {accountState.account.currency} ·{' '}
          {accountState.account.status}
        </p>
      </section>
      <TransactionHistory accountId={accountId} initial={transactions.value} />
    </div>
  );
}
