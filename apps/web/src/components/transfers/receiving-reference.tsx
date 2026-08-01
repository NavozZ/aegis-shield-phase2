'use client';
import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-provider';
import { transferCopy } from './transfer-copy';
export function ReceivingReference({ reference }: { reference: string }) {
  const { language } = useLanguage();
  const copyText = transferCopy[language];
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard?.writeText(reference);
    setCopied(true);
  }
  return (
    <section className="receive-panel" aria-labelledby="receive-heading">
      <h3 id="receive-heading">{copyText.receiveMoney}</h3>
      <p>{copyText.receiveHelp}</p>
      <code>{reference}</code>
      <button
        type="button"
        className="button button-secondary"
        onClick={() => void copy()}
      >
        {copied ? copyText.copied : copyText.copyReference}
      </button>
      <p className="sr-only" aria-live="polite">
        {copied ? copyText.referenceCopied : ''}
      </p>
    </section>
  );
}
