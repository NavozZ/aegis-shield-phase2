import { redirect } from 'next/navigation';
import { IncidentDetail } from '@/components/security-ops/incident-detail';
import { getServerOperator } from '@/lib/security-ops/server-operator';
export default async function IncidentPage({
  params,
}: {
  params: Promise<{ incidentId: string }>;
}) {
  const state = await getServerOperator();
  if (state.status === 'unauthenticated') redirect('/security-ops/sign-in');
  if (state.status === 'unavailable')
    return (
      <main id="security-ops-main" className="ops-shell">
        <p role="alert">Operator authorization is unavailable.</p>
      </main>
    );
  const { incidentId } = await params;
  return <IncidentDetail incidentId={incidentId} />;
}
