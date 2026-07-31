import Link from 'next/link';
import { AegisBrand } from '@/components/layout/aegis-brand';
import { LanguageSelector } from '@/components/layout/language-selector';
import { PrototypeWarning } from '@/components/ui/feedback';
import { getServerSession } from '@/lib/auth/server-session';
import { getServerDictionary } from '@/lib/i18n/server';

export default async function Home() {
  const [dictionary, session] = await Promise.all([
    getServerDictionary(),
    getServerSession(),
  ]);
  const principles = [
    [dictionary.inclusive, dictionary.inclusiveBody],
    [dictionary.strongAuth, dictionary.strongAuthBody],
    [dictionary.protectedSessions, dictionary.protectedSessionsBody],
    [dictionary.recoverable, dictionary.recoverableBody],
  ];
  return (
    <div className="landing-page">
      <a href="#main-content" className="skip-link">
        {dictionary.skip}
      </a>
      <header className="topbar">
        <AegisBrand />
        <LanguageSelector />
      </header>
      <main id="main-content">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">{dictionary.phase}</p>
            <p className="tagline">{dictionary.tagline}</p>
            <h1>{dictionary.landingTitle}</h1>
            <p className="lede">{dictionary.landingBody}</p>
            <div className="button-row">
              {session.status === 'authenticated' ? (
                <Link className="button button-primary" href="/app">
                  {dictionary.continueWorkspace}
                </Link>
              ) : (
                <>
                  <Link className="button button-primary" href="/onboarding">
                    {dictionary.createAccess}
                  </Link>
                  <Link className="button button-secondary" href="/sign-in">
                    {dictionary.signIn}
                  </Link>
                </>
              )}
            </div>
          </div>
          <aside className="method-panel">
            <p className="eyebrow">{dictionary.methods}</p>
            <h2>{dictionary.passkey}</h2>
            <p>{dictionary.fallback}</p>
            <div className="shield-orbit" aria-hidden="true">
              <span>✓</span>
            </div>
          </aside>
        </section>
        <section className="principles" aria-labelledby="principles-title">
          <div>
            <p className="eyebrow">AEGIS</p>
            <h2 id="principles-title">{dictionary.principles}</h2>
          </div>
          <div className="principle-grid">
            {principles.map(([title, body], index) => (
              <article key={title}>
                <span>0{index + 1}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="prototype-section">
          <PrototypeWarning title={dictionary.prototypeTitle}>
            {dictionary.prototypeBody}
          </PrototypeWarning>
        </section>
      </main>
      <footer className="site-footer">AEGIS Shield · {dictionary.phase}</footer>
    </div>
  );
}
