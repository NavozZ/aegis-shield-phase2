import Link from 'next/link';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { AuthShell } from '../layout/auth-shell';

export function ServiceUnavailable({ dictionary }: { dictionary: Dictionary }) {
  return (
    <AuthShell>
      <p className="eyebrow">AEGIS Shield</p>
      <h1>{dictionary.serviceUnavailable}</h1>
      <p className="lede">{dictionary.networkUnavailable}</p>
      <Link className="button button-primary" href="/sign-in">
        {dictionary.retry}
      </Link>
    </AuthShell>
  );
}
