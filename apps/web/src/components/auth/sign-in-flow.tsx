'use client';

import {
  e164PhoneSchema,
  pinFallbackLoginSchema,
  pinFallbackRequestSchema,
} from '@aegis/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { authErrorMessage } from '@/hooks/use-auth-message';
import { authClient } from '@/lib/api/auth-client';
import {
  authenticateWithPasskey,
  isPasskeySupported,
} from '@/lib/auth/passkeys';
import { interpolate } from '@/lib/i18n/dictionaries';
import { useLanguage } from '@/lib/i18n/language-provider';
import { OtpField, PhoneField, PinField } from './fields';
import {
  FormErrorSummary,
  LoadingButton,
  SecurityNotice,
  StatusBanner,
} from '../ui/feedback';

export function SignInFlow() {
  const router = useRouter();
  const { dictionary } = useLanguage();
  const [fallback, setFallback] = useState(false);
  const [otpStep, setOtpStep] = useState(false);
  const supported = useSyncExternalStore(
    () => () => undefined,
    isPasskeySupported,
    () => false,
  );
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState('');
  const [demoOtp, setDemoOtp] = useState<string>();
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const errorRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (otpStep) headingRef.current?.focus();
  }, [otpStep]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [cooldown]);
  function showError(message: string) {
    setError(message);
    queueMicrotask(() => errorRef.current?.focus());
  }
  function finish() {
    setPhone('');
    setPin('');
    setOtp('');
    setChallengeId('');
    setDemoOtp(undefined);
    router.replace('/app');
    router.refresh();
  }

  async function passkeySignIn() {
    setLoading(true);
    setError(undefined);
    try {
      await authenticateWithPasskey();
      await authClient.getSession();
      finish();
    } catch (caught) {
      showError(
        caught instanceof DOMException && caught.name === 'NotAllowedError'
          ? dictionary.passkeyCancelled
          : authErrorMessage(caught, dictionary),
      );
    } finally {
      setLoading(false);
    }
  }
  async function requestFallback(event?: React.FormEvent) {
    event?.preventDefault();
    setError(undefined);
    const parsed = pinFallbackRequestSchema.safeParse({ phone, pin });
    if (!parsed.success || !e164PhoneSchema.safeParse(phone).success) {
      showError(dictionary.invalidInput);
      return;
    }
    setLoading(true);
    try {
      const response = await authClient.requestFallbackOtp(parsed.data);
      setChallengeId(response.challengeId);
      setDemoOtp(response.demoOtp);
      setOtp('');
      setCooldown(60);
      setOtpStep(true);
    } catch (caught) {
      showError(authErrorMessage(caught, dictionary));
    } finally {
      setLoading(false);
    }
  }
  async function completeFallback(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    const parsed = pinFallbackLoginSchema.safeParse({
      phone,
      pin,
      challengeId,
      otp,
    });
    if (!parsed.success) {
      showError(dictionary.invalidOtp);
      return;
    }
    setLoading(true);
    try {
      await authClient.completeFallbackLogin(parsed.data);
      await authClient.getSession();
      finish();
    } catch (caught) {
      const message = authErrorMessage(caught, dictionary);
      showError(message);
      if (message === dictionary.temporarilyLocked) {
        setPin('');
        setOtp('');
        setChallengeId('');
        setOtpStep(false);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      <p className="eyebrow">{dictionary.phase}</p>
      <h1 ref={headingRef} tabIndex={-1}>
        {dictionary.signInTitle}
      </h1>
      <p className="lede">{dictionary.signInIntro}</p>
      <FormErrorSummary
        title={dictionary.errorSummary}
        message={error}
        focusRef={errorRef}
      />
      {!fallback && (
        <div className="stack">
          <SecurityNotice title={dictionary.passkey}>
            {dictionary.passkeyBody}
          </SecurityNotice>
          {!supported && (
            <StatusBanner>{dictionary.passkeyUnavailable}</StatusBanner>
          )}
          <LoadingButton
            type="button"
            className="button button-primary"
            loading={loading}
            loadingLabel={dictionary.loading}
            disabled={!supported}
            onClick={passkeySignIn}
          >
            {dictionary.passkeySignIn}
          </LoadingButton>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setFallback(true)}
          >
            {dictionary.useFallback}
          </button>
        </div>
      )}
      {fallback && !otpStep && (
        <form className="stack" onSubmit={requestFallback} noValidate>
          <PhoneField
            value={phone}
            onChange={setPhone}
            disabled={loading}
            dictionary={dictionary}
          />
          <PinField
            id="sign-in-pin"
            label={dictionary.pinLabel}
            value={pin}
            onChange={setPin}
            disabled={loading}
            dictionary={dictionary}
          />
          <LoadingButton
            className="button button-primary"
            loading={loading}
            loadingLabel={dictionary.loading}
          >
            {dictionary.requestSignInOtp}
          </LoadingButton>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setFallback(false);
              setPhone('');
              setPin('');
            }}
          >
            {dictionary.backPasskey}
          </button>
        </form>
      )}
      {fallback && otpStep && (
        <form className="stack" onSubmit={completeFallback} noValidate>
          <StatusBanner tone="success">{dictionary.accepted}</StatusBanner>
          {demoOtp && (
            <StatusBanner>
              {dictionary.demoOtp}: <span className="demo-code">{demoOtp}</span>
            </StatusBanner>
          )}
          <OtpField
            value={otp}
            onChange={setOtp}
            disabled={loading}
            dictionary={dictionary}
          />
          <LoadingButton
            className="button button-primary"
            loading={loading}
            loadingLabel={dictionary.loading}
          >
            {dictionary.completeSignIn}
          </LoadingButton>
          <button
            type="button"
            className="button button-secondary"
            disabled={loading || cooldown > 0}
            onClick={() => requestFallback()}
          >
            {cooldown > 0
              ? interpolate(dictionary.resendIn, { seconds: cooldown })
              : dictionary.resend}
          </button>
        </form>
      )}
    </div>
  );
}
