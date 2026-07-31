import { redirect } from 'next/navigation';
import { AuthenticatedShell } from '@/components/layout/authenticated-shell';
import { ServiceUnavailable } from '@/components/ui/service-unavailable';
import { getServerSession } from '@/lib/auth/server-session';
import { getServerDictionary } from '@/lib/i18n/server';

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, dictionary] = await Promise.all([
    getServerSession(),
    getServerDictionary(),
  ]);
  if (state.status === 'unauthenticated') redirect('/sign-in');
  if (state.status === 'unavailable')
    return <ServiceUnavailable dictionary={dictionary} />;
  return (
    <AuthenticatedShell session={state.session}>{children}</AuthenticatedShell>
  );
}
