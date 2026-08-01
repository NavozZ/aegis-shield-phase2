import Link from 'next/link';
import { TransactionHistory } from '@/components/accounts/transaction-history';
import { getServerAccount } from '@/lib/accounts/server-accounts';
import { getServerTransactions } from '@/lib/accounts/server-transactions';
import { getServerDictionary } from '@/lib/i18n/server';

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { accountId } = await params;
  const dictionary = await getServerDictionary();
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
    return <p role="status">{dictionary.historyUnavailable}</p>;
  return (
    <div className="workspace-content">
      <Link href="/app">← {dictionary.backToDashboard}</Link>
      <section className="account-panel">
        <p className="eyebrow">{dictionary.accountDetails}</p>
        <h1>{accountState.account.maskedReference}</h1>
        <p>
          {accountState.account.productType} · {accountState.account.currency} ·{' '}
          {accountState.account.status}
        </p>
      </section>
      <TransactionHistory
        key={query.toString()}
        accountId={accountId}
        initial={transactions.value}
      />
    </div>
  );
}
