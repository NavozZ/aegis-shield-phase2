import Link from 'next/link';
import { PasskeyEnrollment } from '@/components/auth/passkey-enrollment';
import { SecurityNotice } from '@/components/ui/feedback';
import { SessionCard } from '@/components/ui/session-card';
import { getServerSession } from '@/lib/auth/server-session';
import { getServerDictionary } from '@/lib/i18n/server';

export default async function SecurityPage() {
  const [state, dictionary] = await Promise.all([
    getServerSession(),
    getServerDictionary(),
  ]);
  if (state.status !== 'authenticated') return null;
  return (
    <div className="workspace-content narrow">
      <p className="eyebrow">{dictionary.sessionProtected}</p>
      <h1>{dictionary.securityTitle}</h1>
      <p className="lede">{dictionary.securityIntro}</p>
      <section>
        <h2>{dictionary.currentAuthentication}</h2>
        <SessionCard session={state.session} dictionary={dictionary} />
      </section>
      <PasskeyEnrollment />
      <div className="security-grid">
        <SecurityNotice title={dictionary.timeoutTitle}>
          {dictionary.timeoutBody}
        </SecurityNotice>
        <SecurityNotice title={dictionary.fallbackTitle}>
          {dictionary.fallbackBody}
        </SecurityNotice>
      </div>
      <Link className="button button-secondary" href="/app">
        {dictionary.backWorkspace}
      </Link>
    </div>
  );
}
