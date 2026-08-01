'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { operatorRequest } from '@/lib/security-ops/operator-client';
export function OperatorSignIn() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await operatorRequest('/sign-in', {
        method: 'POST',
        body: { accessToken: token },
      });
      setToken('');
      router.replace('/security-ops');
      router.refresh();
    } catch {
      setError(
        'Operator authentication failed. Check the development access setup and try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="auth-card stack" onSubmit={submit}>
      <p className="eyebrow">Restricted security operations</p>
      <h1>Operator sign-in</h1>
      <p className="lede">
        This console is separate from customer banking sessions. Actions are
        authorized, rate-limited and audited.
      </p>
      {error ? (
        <p role="alert" className="status-banner status-error">
          {error}
        </p>
      ) : null}
      <label className="field">
        <span>Development operator access token</span>
        <input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          minLength={16}
          required
          aria-describedby="operator-token-hint"
        />
        <small id="operator-token-hint" className="field-hint">
          Configured only through the local RISK_OPERATOR_BOOTSTRAP_TOKEN
          environment value. Disabled in production.
        </small>
      </label>
      <button className="button button-primary" disabled={busy}>
        {busy ? 'Authenticating…' : 'Open security console'}
      </button>
    </form>
  );
}
