import { redirect } from 'next/navigation';
import { SignInFlow } from '@/components/auth/sign-in-flow';
import { AuthShell } from '@/components/layout/auth-shell';
import { getServerSession } from '@/lib/auth/server-session';

export default async function SignInPage() {
  if ((await getServerSession()).status === 'authenticated') redirect('/app');
  return (
    <AuthShell>
      <SignInFlow />
    </AuthShell>
  );
}
