'use client';

import { useRef, useState } from 'react';
import { authErrorMessage } from '@/hooks/use-auth-message';
import { registerPasskey } from '@/lib/auth/passkeys';
import { useLanguage } from '@/lib/i18n/language-provider';
import {
  FormErrorSummary,
  LoadingButton,
  SecurityNotice,
  StatusBanner,
} from '../ui/feedback';

export function PasskeyEnrollment({ onSuccess }: { onSuccess?: () => void }) {
  const { dictionary } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [complete, setComplete] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  async function addPasskey() {
    setLoading(true);
    setError(undefined);
    try {
      await registerPasskey('AEGIS browser passkey');
      setComplete(true);
      onSuccess?.();
    } catch (caught) {
      const cancelled =
        caught instanceof DOMException && caught.name === 'NotAllowedError';
      setError(
        cancelled
          ? dictionary.passkeyCancelled
          : authErrorMessage(caught, dictionary),
      );
      queueMicrotask(() => errorRef.current?.focus());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      <SecurityNotice title={dictionary.passkeyTitle}>
        {dictionary.passkeyBody}
      </SecurityNotice>
      <p className="field-hint">{dictionary.biometricNotice}</p>
      <FormErrorSummary
        title={dictionary.errorSummary}
        message={error}
        focusRef={errorRef}
      />
      {complete && (
        <StatusBanner tone="success">{dictionary.passkeyAdded}</StatusBanner>
      )}
      <LoadingButton
        type="button"
        className="button button-primary"
        loading={loading}
        loadingLabel={dictionary.loading}
        onClick={addPasskey}
      >
        {dictionary.addPasskey}
      </LoadingButton>
    </div>
  );
}
