'use client';

import { formatMoney, type CustomerAccountDetail } from '@aegis/contracts';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { authErrorMessage } from '@/hooks/use-auth-message';
import {
  accountsClient,
  createIdempotencyKey,
} from '@/lib/api/accounts-client';
import { useLanguage } from '@/lib/i18n/language-provider';
import {
  FormErrorSummary,
  LoadingButton,
  SecurityNotice,
} from '../ui/feedback';

export function AccountPanel({
  initialAccount,
  unavailable = false,
}: {
  initialAccount: CustomerAccountDetail | null;
  unavailable?: boolean;
}) {
  const router = useRouter();
  const { dictionary } = useLanguage();
  const [account, setAccount] = useState(initialAccount);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const errorRef = useRef<HTMLDivElement>(null);
  // Retained across retries so a resubmitted attempt cannot create a second
  // account; cleared only once an attempt succeeds.
  const idempotencyKey = useRef<string>(undefined);

  async function createAccount() {
    if (loading) return;
    setLoading(true);
    setError(undefined);
    idempotencyKey.current ??= createIdempotencyKey();
    try {
      const created = await accountsClient.provisionDefault(
        idempotencyKey.current,
      );
      idempotencyKey.current = undefined;
      setAccount(created);
      router.refresh();
    } catch (caught) {
      setError(authErrorMessage(caught, dictionary));
      queueMicrotask(() => errorRef.current?.focus());
    } finally {
      setLoading(false);
    }
  }

  if (unavailable && !account) {
    return (
      <section aria-labelledby="account-heading" className="account-panel">
        <h2 id="account-heading">{dictionary.accountsCard}</h2>
        <p role="status">{dictionary.serviceUnavailable}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="account-heading" className="account-panel">
      <h2 id="account-heading">{dictionary.accountsCard}</h2>
      <FormErrorSummary
        title={dictionary.errorSummary}
        message={error}
        focusRef={errorRef}
      />
      {account ? (
        <>
          <dl className="account-summary">
            <div>
              <dt>{dictionary.accountReference}</dt>
              <dd>{account.maskedReference}</dd>
            </div>
            <div>
              <dt>{dictionary.accountProduct}</dt>
              <dd>{dictionary.tierZeroWallet}</dd>
            </div>
            <div>
              <dt>{dictionary.accountStatus}</dt>
              <dd>{dictionary.statusActive}</dd>
            </div>
            <div>
              <dt>{dictionary.accountCurrency}</dt>
              <dd>{account.currency}</dd>
            </div>
            <div>
              <dt>{dictionary.accountBalance}</dt>
              <dd className="account-balance">
                {formatMoney(account.balance)}
              </dd>
            </div>
          </dl>
          <p className="account-next">{dictionary.historyInPrompt06}</p>
        </>
      ) : (
        <>
          <p className="account-empty">{dictionary.noAccountYet}</p>
          <p>{dictionary.tierZeroExplainer}</p>
          <LoadingButton
            type="button"
            className="button button-primary"
            loading={loading}
            loadingLabel={dictionary.loading}
            onClick={createAccount}
          >
            {dictionary.createTierZeroAccount}
          </LoadingButton>
        </>
      )}
      <SecurityNotice title={dictionary.zeroFundsTitle}>
        {dictionary.zeroFundsBody}
      </SecurityNotice>
    </section>
  );
}
