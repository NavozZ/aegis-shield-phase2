'use client';
import {
  formatMoney,
  lkrAmountToMinorUnits,
  type CustomerAccountSummary,
  type TransferPreviewResponse,
} from '@aegis/contracts';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { AuthClientError } from '@/lib/api/auth-client';
import { useLanguage } from '@/lib/i18n/language-provider';
import {
  createTransferIdempotencyKey,
  transfersClient,
} from '@/lib/api/transfers-client';
import { transferCopy } from './transfer-copy';
export function TransferForm({
  accounts,
}: {
  accounts: CustomerAccountSummary[];
}) {
  const router = useRouter();
  const { language } = useLanguage();
  const copy = transferCopy[language];
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
      setError(copy.invalid);
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
    } catch (caught) {
      const code = caught instanceof AuthClientError ? caught.code : undefined;
      setError(
        code === 'TRANSFER_STEP_UP_FAILED'
          ? copy.wrongPin
          : code === 'INTENT_EXPIRED'
            ? copy.expired
            : code === 'INSUFFICIENT_FUNDS'
              ? copy.insufficient
              : code === 'LIMIT_EXCEEDED'
                ? copy.dailyLimit
                : copy.authorizationFailed,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="transfer-form" aria-labelledby="send-heading">
      <h1 id="send-heading">{copy.sendMoney}</h1>
      {error ? (
        <p role="alert" tabIndex={-1}>
          {error}
        </p>
      ) : null}
      {!preview ? (
        <>
          <label className="field">
            <span>{copy.sourceAccount}</span>
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
            <span>{copy.recipient}</span>
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
            <span>{copy.amount}</span>
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
            {copy.preview}
          </button>
        </>
      ) : (
        <>
          <h2>{copy.review}</h2>
          <dl>
            <div>
              <dt>{copy.from}</dt>
              <dd>{preview.sourceMaskedReference}</dd>
            </div>
            <div>
              <dt>{copy.to}</dt>
              <dd>{preview.recipientMaskedReference}</dd>
            </div>
            <div>
              <dt>{copy.amount}</dt>
              <dd>{formatMoney(preview.amount)}</dd>
            </div>
            <div>
              <dt>{copy.available}</dt>
              <dd>{formatMoney(preview.sourceBalance)}</dd>
            </div>
          </dl>
          <p>{copy.verify}</p>
          <label className="field">
            <span>{copy.enterPin}</span>
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
            {copy.confirm}
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => setPreview(undefined)}
          >
            {copy.edit}
          </button>
        </>
      )}
    </section>
  );
}
