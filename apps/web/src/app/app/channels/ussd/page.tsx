import { getServerSession } from '@/lib/auth/server-session';
import { getServerDictionary } from '@/lib/i18n/server';
import Link from 'next/link';

export default async function UssdPage() {
  const [state, dictionary] = await Promise.all([
    getServerSession(),
    getServerDictionary(),
  ]);

  if (state.status !== 'authenticated') return null;

  return (
    <div className="workspace-content">
      <div className="workspace-title">
        <div>
          <p className="eyebrow">USSD Banking</p>
          <h1>USSD Simulator</h1>
          <p className="lede">Simulate a mobile phone USSD session (*123#).</p>
        </div>
        <Link className="button button-secondary" href="/app">
          Back
        </Link>
      </div>

      <section>
        <div className="feature-card">
          <h2>Simulator Screen</h2>
          <p>Dial *123# to begin.</p>
          <form method="POST" action="/api/v1/channels/ussd/simulate" style={{ marginTop: '1rem' }}>
            <input name="input" placeholder="USSD Input (e.g. *123#)" required style={{ display: 'block', marginBottom: '1rem', width: '100%', padding: '0.5rem' }} />
            <button type="submit" className="button button-primary">Send</button>
          </form>
        </div>
      </section>
    </div>
  );
}
