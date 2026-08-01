import Link from 'next/link';
import { AccountPanel } from '@/components/accounts/account-panel';
import { RecentActivity } from '@/components/accounts/recent-activity';
import { EmptyFeatureCard, SessionCard } from '@/components/ui/session-card';
import { getServerAccount } from '@/lib/accounts/server-accounts';
import { getServerTransactions } from '@/lib/accounts/server-transactions';
import { getServerSession } from '@/lib/auth/server-session';
import { getServerDictionary } from '@/lib/i18n/server';

export default async function WorkspacePage() {
  const [state, dictionary] = await Promise.all([
    getServerSession(),
    getServerDictionary(),
  ]);
  if (state.status !== 'authenticated') return null;
  const accountState = await getServerAccount();
  const recent =
    accountState.status === 'ready' && accountState.account
      ? await getServerTransactions(accountState.account.id, '?pageSize=5')
      : undefined;
  const cards = [
    [dictionary.qrCard, dictionary.comingLater],
    [dictionary.recoveryCard, dictionary.comingLater],
  ];
  return (
    <div className="workspace-content">
      <div className="workspace-title">
        <div>
          <p className="eyebrow">{dictionary.sessionProtected}</p>
          <h1>{dictionary.workspace}</h1>
          <p className="lede">{dictionary.workspaceIntro}</p>
        </div>
        <Link className="button button-secondary" href="/app/security">
          {dictionary.securitySettings}
        </Link>
      </div>
      <AccountPanel
        initialAccount={
          accountState.status === 'ready' ? accountState.account : null
        }
        unavailable={accountState.status === 'unavailable'}
      />
      {accountState.status === 'ready' && accountState.account ? (
        <RecentActivity
          accountId={accountState.account.id}
          transactions={
            recent?.status === 'ready' ? recent.value.transactions : []
          }
          unavailable={recent !== undefined && recent.status !== 'ready'}
        />
      ) : null}
      <section aria-labelledby="session-heading">
        <h2 id="session-heading">{dictionary.sessionStatus}</h2>
        <SessionCard session={state.session} dictionary={dictionary} />
        <p className="session-expiry">
          {dictionary.sessionExpires}:{' '}
          <time dateTime={state.session.expiresAt}>
            {new Date(state.session.expiresAt).toLocaleString()}
          </time>
        </p>
      </section>
      <section className="feature-grid" aria-label={dictionary.workspace}>
        <Link className="feature-card" href="/app/transfers">
          <span aria-hidden="true">↔</span>
          <h2>{dictionary.transfersCard}</h2>
          <p>Send or receive secure customer transfers.</p>
        </Link>
        <Link className="feature-card" href="/app/channels/qr">
          <span aria-hidden="true">📷</span>
          <h2>QR Pay</h2>
          <p>Scan a QR code to pay instantly.</p>
        </Link>
        <Link className="feature-card" href="/app/channels/agent">
          <span aria-hidden="true">🏪</span>
          <h2>Agent Operations</h2>
          <p>Perform Cash-In and Cash-Out transactions.</p>
        </Link>
        <Link className="feature-card" href="/app/channels/ussd">
          <span aria-hidden="true">📱</span>
          <h2>USSD Banking</h2>
          <p>Simulate a mobile phone USSD session.</p>
        </Link>
      </section>
    </div>
  );
}
