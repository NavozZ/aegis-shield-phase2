import { getServerSession } from '@/lib/auth/server-session';
import { getServerDictionary } from '@/lib/i18n/server';
import Link from 'next/link';

export default async function QrPage() {
  const [state] = await Promise.all([
    getServerSession(),
    getServerDictionary(),
  ]);

  if (state.status !== 'authenticated') return null;

  return (
    <div className="workspace-content">
      <div className="workspace-title">
        <div>
          <p className="eyebrow">Secure Payments</p>
          <h1>QR Pay</h1>
          <p className="lede">Scan a QR code to pay instantly.</p>
        </div>
        <Link className="button button-secondary" href="/app">
          Back
        </Link>
      </div>

      <section>
        <div className="feature-card">
          <h2>Scanner</h2>
          <p>
            Mock QR Scanner component goes here. (Integrating with
            /api/v1/channels/qr/preview and /api/v1/channels/qr/confirm)
          </p>
          <form
            method="POST"
            action="/api/v1/channels/qr/preview"
            style={{ marginTop: '1rem' }}
          >
            <input
              name="payload"
              placeholder="QR Payload String"
              required
              style={{
                display: 'block',
                marginBottom: '1rem',
                width: '100%',
                padding: '0.5rem',
              }}
            />
            <input
              type="hidden"
              name="sourceAccountId"
              value="00000000-0000-0000-0000-000000000000"
            />
            <button type="submit" className="button button-primary">
              Preview Payment
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
