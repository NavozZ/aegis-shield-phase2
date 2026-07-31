import { redirect } from 'next/navigation';
import { OnboardingFlow } from '@/components/auth/onboarding-flow';
import { AuthShell } from '@/components/layout/auth-shell';
import { getServerSession } from '@/lib/auth/server-session';

export default async function OnboardingPage() {
  if ((await getServerSession()).status === 'authenticated') redirect('/app');
  return (
    <AuthShell>
      <OnboardingFlow />
    </AuthShell>
  );
}
