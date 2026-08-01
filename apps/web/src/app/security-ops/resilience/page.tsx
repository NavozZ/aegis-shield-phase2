import { redirect } from 'next/navigation';
import { RecoveryConsole } from '@/components/security-ops/recovery-console';
import { getServerOperator } from '@/lib/security-ops/server-operator';

/*
 * The recovery console is behind the same operator gate as the rest of
 * `/security-ops`: the session is validated on the server before any recovery
 * evidence is requested, so an unauthenticated visitor is redirected rather
 * than shown a shell that fetches and fails.
 */
export default async function ResilienceOperationsPage() {
  const state = await getServerOperator();
  if (state.status === 'unauthenticated') redirect('/security-ops/sign-in');
  if (state.status === 'unavailable')
    return (
      <main id="security-ops-main" className="ops-shell">
        <h1>Recovery operations unavailable</h1>
        <p role="alert">
          The operator authorization service could not be verified. No recovery
          information is shown.
        </p>
      </main>
    );
  return <RecoveryConsole />;
}
