'use client';

import { useLanguage } from '@/lib/i18n/language-provider';
import { AegisBrand } from './aegis-brand';
import { LanguageSelector } from './language-selector';

export function AuthShell({ children }: { children: React.ReactNode }) {
  const { dictionary } = useLanguage();
  return (
    <div className="auth-page">
      <a href="#main-content" className="skip-link">
        {dictionary.skip}
      </a>
      <header className="topbar">
        <AegisBrand />
        <LanguageSelector />
      </header>
      <main id="main-content" className="auth-main">
        <section className="auth-card">{children}</section>
      </main>
      <footer className="site-footer">AEGIS Shield · {dictionary.phase}</footer>
    </div>
  );
}
