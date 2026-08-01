import Link from 'next/link';
import { TransferForm } from '@/components/transfers/transfer-form';
import { getServerAccount } from '@/lib/accounts/server-accounts';
export default async function NewTransferPage() {
  const state = await getServerAccount();
  if (state.status !== 'ready' || !state.account)
    return (
      <div className="workspace-content">
        <h1>Send money</h1>
        <p role="status">
          Create an active Tier-0 account before sending money.
        </p>
        <Link className="button button-secondary" href="/app">
          Back to dashboard
        </Link>
      </div>
    );
  const account = state.account;
  return (
    <div className="workspace-content narrow">
      <Link href="/app/transfers">← Back to transfers</Link>
      <TransferForm
        accounts={[
          {
            id: account.id,
            maskedReference: account.maskedReference,
            productType: account.productType,
            status: account.status,
            currency: account.currency,
            createdAt: account.createdAt,
          },
        ]}
      />
    </div>
  );
}
