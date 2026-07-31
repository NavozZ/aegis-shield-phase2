import Link from 'next/link';
import { AccountPanel } from '@/components/accounts/account-panel';
import { EmptyFeatureCard, SessionCard } from '@/components/ui/session-card';
import { getServerAccount } from '@/lib/accounts/server-accounts';
import { getServerSession } from '@/lib/auth/server-session';
import { getServerDictionary } from '@/lib/i18n/server';

export default async function WorkspacePage() {
  const [state, dictionary] = await Promise.all([
    getServerSession(),
    getServerDictionary(),
  ]);
  if (state.status !== 'authenticated') return null;
  const accountState = await getServerAccount();
  const cards = [
    [dictionary.transfersCard, dictionary.comingLater],
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
        {cards.map(([title, status]) => (
          <EmptyFeatureCard key={title} title={title} status={status} />
        ))}
      </section>
    </div>
  );
}
