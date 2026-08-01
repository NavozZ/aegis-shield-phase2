import Link from 'next/link';
import { SabclStatusPanel } from '@/components/sabcl/sabcl-status-panel';
import { SecurityNotice } from '@/components/ui/feedback';
import { getServerSession } from '@/lib/auth/server-session';
import { getServerDictionary } from '@/lib/i18n/server';
import { getSabclStatus } from '@/lib/sabcl/server-sabcl-status';

/**
 * Operator-facing SABCL status page.
 *
 * Behind the authenticated workspace layout, and rendered entirely on the
 * server: no SABCL cryptographic API reaches the client bundle, and the browser
 * cannot construct a SABCL call from this page. It reads a status document and
 * displays it.
 *
 * The page states plainly what the layer does and does not protect. An operator
 * looking at a row of green pills should not come away believing more than the
 * implementation delivers.
 */
export default async function SabclStatusPage() {
  const [state, dictionary, status] = await Promise.all([
    getServerSession(),
    getServerDictionary(),
    getSabclStatus(),
  ]);
  if (state.status !== 'authenticated') return null;

  return (
    <div className="workspace-content">
      <p className="eyebrow">{dictionary.sessionProtected}</p>
      <h1>{dictionary.sabclTitle}</h1>
      <p className="lede">{dictionary.sabclIntro}</p>

      <SecurityNotice title={dictionary.sabclScopeTitle}>
        {dictionary.sabclScopeBody}
      </SecurityNotice>

      {status.status === 'ok' ? (
        <SabclStatusPanel status={status.data} dictionary={dictionary} />
      ) : (
        <section aria-labelledby="sabcl-unavailable-heading">
          <h2 id="sabcl-unavailable-heading">{dictionary.sabclUnavailable}</h2>
          <p role="status">{dictionary.sabclUnavailableBody}</p>
        </section>
      )}

      <SecurityNotice title={dictionary.prototypeTitle}>
        {dictionary.sabclDisclaimer}
      </SecurityNotice>

      <Link className="button button-secondary" href="/app">
        {dictionary.backWorkspace}
      </Link>
    </div>
  );
}
