'use client';

import {
  createPinSchema,
  requestOtpSchema,
  securePrototypePinSchema,
  verifyOtpSchema,
  type SessionResponse,
} from '@aegis/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { authErrorMessage } from '@/hooks/use-auth-message';
import { authClient } from '@/lib/api/auth-client';
import { interpolate } from '@/lib/i18n/dictionaries';
import { useLanguage } from '@/lib/i18n/language-provider';
import { AuthenticationStepper } from './authentication-stepper';
import { OtpField, PhoneField, PinField } from './fields';
import { PasskeyEnrollment } from './passkey-enrollment';
import {
  FormErrorSummary,
  LoadingButton,
  PrototypeWarning,
  StatusBanner,
} from '../ui/feedback';
import { SessionCard } from '../ui/session-card';

type Step = 0 | 1 | 2 | 3 | 4;

export function OnboardingFlow() {
  const router = useRouter();
  const { language, dictionary, setLanguage } = useLanguage();
  const [step, setStep] = useState<Step>(0);
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [challengeId, setChallengeId] = useState('');
  const [demoOtp, setDemoOtp] = useState<string>();
  const [otp, setOtp] = useState('');
  const [enrollmentToken, setEnrollmentToken] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirmation, setPinConfirmation] = useState('');
  const [session, setSession] = useState<SessionResponse>();
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldError, setFieldError] = useState<string>();
  const restarted = useSyncExternalStore(
    () => () => undefined,
    () =>
      (
        performance.getEntriesByType('navigation')[0] as
          PerformanceNavigationTiming | undefined
      )?.type === 'reload',
    () => false,
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (step > 0) headingRef.current?.focus();
  }, [step]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [cooldown]);

  function showError(message: string, field?: string) {
    setError(message);
    setFieldError(field);
    queueMicrotask(() => errorRef.current?.focus());
  }

  async function requestOtp(event?: React.FormEvent) {
    event?.preventDefault();
    setError(undefined);
    setFieldError(undefined);
    const parsed = requestOtpSchema.safeParse({
      phone,
      preferredLanguage: language,
      consentAccepted: consent,
    });
    if (!parsed.success) {
      if (!consent)
        showError(dictionary.consentRequired, dictionary.consentRequired);
      else showError(dictionary.invalidPhone, dictionary.invalidPhone);
      return;
    }
    setLoading(true);
    try {
      const response = await authClient.requestOnboardingOtp(parsed.data);
      setChallengeId(response.challengeId);
      setDemoOtp(response.demoOtp);
      setOtp('');
      setCooldown(60);
      setStep(1);
    } catch (caught) {
      showError(authErrorMessage(caught, dictionary));
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setFieldError(undefined);
    const parsed = verifyOtpSchema.safeParse({ phone, challengeId, otp });
    if (!parsed.success) {
      showError(dictionary.invalidOtp, dictionary.invalidOtp);
      return;
    }
    setLoading(true);
    try {
      const response = await authClient.verifyOnboardingOtp(parsed.data);
      setEnrollmentToken(response.enrollmentToken);
      setOtp('');
      setDemoOtp(undefined);
      setStep(2);
    } catch (caught) {
      showError(authErrorMessage(caught, dictionary), dictionary.invalidOtp);
    } finally {
      setLoading(false);
    }
  }

  async function resendOtp() {
    if (cooldown > 0) return;
    setLoading(true);
    setError(undefined);
    try {
      const response = await authClient.requestOnboardingOtp({
        phone,
        preferredLanguage: language,
        consentAccepted: true,
      });
      setChallengeId(response.challengeId);
      setDemoOtp(response.demoOtp);
      setOtp('');
      setCooldown(60);
    } catch (caught) {
      showError(authErrorMessage(caught, dictionary));
    } finally {
      setLoading(false);
    }
  }

  async function createPin(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setFieldError(undefined);
    if (!securePrototypePinSchema.safeParse(pin).success) {
      showError(dictionary.weakPin, dictionary.weakPin);
      return;
    }
    const parsed = createPinSchema.safeParse({
      enrollmentToken,
      pin,
      pinConfirmation,
    });
    if (!parsed.success) {
      showError(dictionary.pinMismatch, dictionary.pinMismatch);
      return;
    }
    setLoading(true);
    try {
      await authClient.createPin(parsed.data);
      const restored = await authClient.getSession();
      setSession(restored);
      setPhone('');
      setChallengeId('');
      setEnrollmentToken('');
      setConsent(false);
      setStep(3);
    } catch (caught) {
      showError(authErrorMessage(caught, dictionary));
    } finally {
      setPin('');
      setPinConfirmation('');
      setLoading(false);
    }
  }

  function finish() {
    router.replace('/app');
    router.refresh();
  }

  return (
    <div className="stack">
      <p className="eyebrow">{dictionary.phase}</p>
      <h1 ref={headingRef} tabIndex={-1}>
        {step === 0
          ? dictionary.onboardingTitle
          : [
              dictionary.phoneStep,
              dictionary.otpStep,
              dictionary.pinStep,
              dictionary.passkeyStep,
              dictionary.completeStep,
            ][step]}
      </h1>
      <p className="lede">{dictionary.onboardingIntro}</p>
      <AuthenticationStepper current={step} dictionary={dictionary} />
      {restarted && step === 0 && (
        <StatusBanner>{dictionary.restartNotice}</StatusBanner>
      )}
      <FormErrorSummary
        title={dictionary.errorSummary}
        message={error}
        focusRef={errorRef}
      />

      {step === 0 && (
        <form className="stack" onSubmit={requestOtp} noValidate>
          <PhoneField
            value={phone}
            onChange={setPhone}
            error={
              fieldError === dictionary.invalidPhone ? fieldError : undefined
            }
            disabled={loading}
            dictionary={dictionary}
          />
          <label className="field">
            <span>{dictionary.chooseLanguage}</span>
            <select
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value as 'EN' | 'SI' | 'TA')
              }
            >
              <option value="EN">English · EN</option>
              <option value="SI">සිංහල · SI</option>
              <option value="TA">தமிழ் · TA</option>
            </select>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              aria-describedby={
                fieldError === dictionary.consentRequired
                  ? 'consent-error'
                  : undefined
              }
            />
            <span>{dictionary.consent}</span>
          </label>
          {fieldError === dictionary.consentRequired && (
            <p id="consent-error" className="field-error">
              {fieldError}
            </p>
          )}
          <LoadingButton
            className="button button-primary"
            loading={loading}
            loadingLabel={dictionary.loading}
          >
            {dictionary.requestOtp}
          </LoadingButton>
        </form>
      )}

      {step === 1 && (
        <form className="stack" onSubmit={verifyOtp} noValidate>
          <StatusBanner tone="success">{dictionary.accepted}</StatusBanner>
          {demoOtp && (
            <PrototypeWarning title={dictionary.demoOtp}>
              <span className="demo-code">{demoOtp}</span>
              <br />
              {dictionary.demoWarning}
            </PrototypeWarning>
          )}
          <OtpField
            value={otp}
            onChange={setOtp}
            error={
              fieldError === dictionary.invalidOtp ? fieldError : undefined
            }
            disabled={loading}
            dictionary={dictionary}
          />
          <LoadingButton
            className="button button-primary"
            loading={loading}
            loadingLabel={dictionary.loading}
          >
            {dictionary.verifyOtp}
          </LoadingButton>
          <button
            className="button button-secondary"
            type="button"
            onClick={resendOtp}
            disabled={loading || cooldown > 0}
          >
            {cooldown > 0
              ? interpolate(dictionary.resendIn, { seconds: cooldown })
              : dictionary.resend}
          </button>
        </form>
      )}

      {step === 2 && (
        <form className="stack" onSubmit={createPin} noValidate>
          <p className="field-hint">{dictionary.pinRules}</p>
          <PinField
            id="new-pin"
            label={dictionary.pinLabel}
            value={pin}
            onChange={setPin}
            error={fieldError === dictionary.weakPin ? fieldError : undefined}
            disabled={loading}
            dictionary={dictionary}
          />
          <PinField
            id="confirm-pin"
            label={dictionary.pinConfirm}
            value={pinConfirmation}
            onChange={setPinConfirmation}
            error={
              fieldError === dictionary.pinMismatch ? fieldError : undefined
            }
            disabled={loading}
            dictionary={dictionary}
          />
          <LoadingButton
            className="button button-primary"
            loading={loading}
            loadingLabel={dictionary.loading}
          >
            {dictionary.createPin}
          </LoadingButton>
        </form>
      )}

      {step === 3 && session && (
        <div className="stack">
          <PasskeyEnrollment onSuccess={finish} />
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setStep(4)}
          >
            {dictionary.skipNow}
          </button>
        </div>
      )}
      {step === 4 && session && (
        <div className="stack">
          <StatusBanner tone="success">{dictionary.accessCreated}</StatusBanner>
          <SessionCard session={session} dictionary={dictionary} />
          <PrototypeWarning title={dictionary.prototypeTitle}>
            {dictionary.prototypeBody}
          </PrototypeWarning>
          <button
            type="button"
            className="button button-primary"
            onClick={finish}
          >
            {dictionary.continue}
          </button>
        </div>
      )}
    </div>
  );
}
