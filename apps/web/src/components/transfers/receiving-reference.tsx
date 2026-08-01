'use client';
import { useState } from 'react';
export function ReceivingReference({ reference }: { reference: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard?.writeText(reference);
    setCopied(true);
  }
  return (
    <section className="receive-panel" aria-labelledby="receive-heading">
      <h3 id="receive-heading">Receive money</h3>
      <p>
        Share this receiving reference only with someone who is sending you
        money.
      </p>
      <code>{reference}</code>
      <button
        type="button"
        className="button button-secondary"
        onClick={() => void copy()}
      >
        {copied ? 'Copied' : 'Copy reference'}
      </button>
      <p className="sr-only" aria-live="polite">
        {copied ? 'Reference copied.' : ''}
      </p>
    </section>
  );
}
