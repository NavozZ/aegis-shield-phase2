import { getServerSession } from '@/lib/auth/server-session';
import { getServerDictionary } from '@/lib/i18n/server';
import Link from 'next/link';

export default async function AgentPage() {
  const [state] = await Promise.all([
    getServerSession(),
    getServerDictionary(),
  ]);

  if (state.status !== 'authenticated') return null;

  return (
    <div className="workspace-content">
      <div className="workspace-title">
        <div>
          <p className="eyebrow">Physical Network</p>
          <h1>Agent Operations</h1>
          <p className="lede">Perform Cash-In and Cash-Out transactions.</p>
        </div>
        <Link className="button button-secondary" href="/app">
          Back
        </Link>
      </div>

      <section className="feature-grid">
        <div className="feature-card">
          <h2>Cash In</h2>
          <p>Deposit physical cash to a customer wallet.</p>
          <form
            method="POST"
            action="/api/v1/channels/agent/cash-in/preview"
            style={{ marginTop: '1rem' }}
          >
            <input
              name="customerReference"
              placeholder="Customer Public Reference"
              required
              style={{
                display: 'block',
                marginBottom: '1rem',
                width: '100%',
                padding: '0.5rem',
              }}
            />
            <input
              name="amountMinor"
              placeholder="Amount (Minor Units)"
              type="number"
              required
              style={{
                display: 'block',
                marginBottom: '1rem',
                width: '100%',
                padding: '0.5rem',
              }}
            />
            <input type="hidden" name="currency" value="LKR" />
            <button type="submit" className="button button-primary">
              Preview Cash In
            </button>
          </form>
        </div>

        <div className="feature-card">
          <h2>Cash Out</h2>
          <p>Withdraw physical cash from a customer wallet.</p>
          <form
            method="POST"
            action="/api/v1/channels/agent/cash-out/preview"
            style={{ marginTop: '1rem' }}
          >
            <input
              name="customerReference"
              placeholder="Customer Public Reference"
              required
              style={{
                display: 'block',
                marginBottom: '1rem',
                width: '100%',
                padding: '0.5rem',
              }}
            />
            <input
              name="amountMinor"
              placeholder="Amount (Minor Units)"
              type="number"
              required
              style={{
                display: 'block',
                marginBottom: '1rem',
                width: '100%',
                padding: '0.5rem',
              }}
            />
            <input type="hidden" name="currency" value="LKR" />
            <button type="submit" className="button button-primary">
              Preview Cash Out
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
