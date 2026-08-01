import { redirect } from 'next/navigation';
import { OperatorDashboard } from '@/components/security-ops/operator-dashboard';
import { getServerOperator } from '@/lib/security-ops/server-operator';
export default async function SecurityOperationsPage() {
  const state = await getServerOperator();
  if (state.status === 'unauthenticated') redirect('/security-ops/sign-in');
  if (state.status === 'unavailable')
    return (
      <main id="security-ops-main" className="ops-shell">
        <h1>Security operations unavailable</h1>
        <p role="alert">
          The operator authorization service could not be verified. No security
          data is shown.
        </p>
      </main>
    );
  return <OperatorDashboard />;
}
