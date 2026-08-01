'use client';

import type { SessionResponse } from '@aegis/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { authErrorMessage } from '@/hooks/use-auth-message';
import { authClient } from '@/lib/api/auth-client';
import { useLanguage } from '@/lib/i18n/language-provider';
import { AegisBrand } from './aegis-brand';
import { LanguageSelector } from './language-selector';
import {
  FormErrorSummary,
  LoadingButton,
  PrototypeWarning,
} from '../ui/feedback';

export function AuthenticatedShell({
  session,
  children,
}: {
  session: SessionResponse;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { dictionary, setLanguage } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setLanguage(session.user.preferredLanguage);
  }, [session.user.preferredLanguage, setLanguage]);
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, []);
  async function logout() {
    setLoading(true);
    setError(undefined);
    try {
      await authClient.logout();
      router.replace('/sign-in');
      router.refresh();
    } catch (caught) {
      setError(authErrorMessage(caught, dictionary));
      queueMicrotask(() => errorRef.current?.focus());
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="workspace-page">
      <a href="#main-content" className="skip-link">
        {dictionary.skip}
      </a>
      <header className="workspace-header">
        <AegisBrand compact />
        <nav aria-label={dictionary.workspace}>
          <Link href="/app">{dictionary.workspace}</Link>
          <Link href="/app/transfers">Transfers</Link>
          <Link href="/app/security">{dictionary.securitySettings}</Link>
        </nav>
        <div className="header-actions">
          <LanguageSelector />
          <LoadingButton
            type="button"
            className="button button-quiet"
            loading={loading}
            loadingLabel={dictionary.loading}
            onClick={logout}
          >
            {dictionary.logout}
          </LoadingButton>
        </div>
      </header>
      <FormErrorSummary
        title={dictionary.errorSummary}
        message={error}
        focusRef={errorRef}
      />
      <main id="main-content" className="workspace-main">
        {children}
      </main>
      <div className="workspace-warning">
        <PrototypeWarning title={dictionary.prototypeTitle}>
          {dictionary.prototypeBody}
        </PrototypeWarning>
      </div>
    </div>
  );
}
