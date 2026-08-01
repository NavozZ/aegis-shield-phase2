'use client';
import {
  formatMoney,
  lkrAmountToMinorUnits,
  type CustomerAccountSummary,
  type TransferPreviewResponse,
} from '@aegis/contracts';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  createTransferIdempotencyKey,
  transfersClient,
} from '@/lib/api/transfers-client';
export function TransferForm({
  accounts,
}: {
  accounts: CustomerAccountSummary[];
}) {
  const router = useRouter();
  const [sourceAccountId, setSourceAccountId] = useState(accounts[0]?.id ?? '');
  const [recipientReference, setRecipientReference] = useState('');
  const [amount, setAmount] = useState('');
  const [preview, setPreview] = useState<TransferPreviewResponse | undefined>(
    undefined,
  );
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const key = useRef<string | undefined>(undefined);
  async function review() {
    try {
      lkrAmountToMinorUnits(amount);
      setBusy(true);
      setError(undefined);
      setPreview(
        await transfersClient.preview({
          sourceAccountId,
          recipientReference,
          amount,
        }),
      );
    } catch {
      setError('Check the recipient reference and amount, then try again.');
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!preview || busy) return;
    try {
      setBusy(true);
      setError(undefined);
      key.current ??= createTransferIdempotencyKey();
      const result = await transfersClient.confirm(
        preview.intentToken,
        pin,
        key.current,
      );
      if (result.status === 'COMPLETED' || result.status === 'PROCESSING')
        router.push(`/app/transfers/${result.id}`);
      else setError('The transfer could not be completed.');
    } catch {
      setError('Authorization failed or the transfer could not be completed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="transfer-form" aria-labelledby="send-heading">
      <h1 id="send-heading">Send money</h1>
      {error ? (
        <p role="alert" tabIndex={-1}>
          {error}
        </p>
      ) : null}
      {!preview ? (
        <>
          <label className="field">
            <span>Source account</span>
            <select
              value={sourceAccountId}
              onChange={(e) => setSourceAccountId(e.target.value)}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.maskedReference} · {account.currency}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Recipient AEGIS reference</span>
            <input
              value={recipientReference}
              onChange={(e) =>
                setRecipientReference(e.target.value.toUpperCase())
              }
              autoComplete="off"
              placeholder="AEGIS-XXXX-XXXX-XXXX"
            />
          </label>
          <label className="field">
            <span>Amount (LKR)</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <button
            type="button"
            className="button button-primary"
            disabled={busy || !sourceAccountId}
            onClick={() => void review()}
          >
            Preview transfer
          </button>
        </>
      ) : (
        <>
          <h2>Review transfer</h2>
          <dl>
            <div>
              <dt>From</dt>
              <dd>{preview.sourceMaskedReference}</dd>
            </div>
            <div>
              <dt>To</dt>
              <dd>{preview.recipientMaskedReference}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>{formatMoney(preview.amount)}</dd>
            </div>
            <div>
              <dt>Available balance</dt>
              <dd>{formatMoney(preview.sourceBalance)}</dd>
            </div>
          </dl>
          <p>Verify the masked recipient and amount before authorizing.</p>
          <label className="field">
            <span>Enter your PIN</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              maxLength={6}
            />
          </label>
          <button
            type="button"
            className="button button-primary"
            disabled={busy || !/^[0-9]{6}$/u.test(pin)}
            onClick={() => void confirm()}
          >
            Confirm transfer
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => setPreview(undefined)}
          >
            Edit details
          </button>
        </>
      )}
    </section>
  );
}
