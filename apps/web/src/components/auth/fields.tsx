'use client';

import { useState } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';

interface FieldProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

export function PhoneField({
  value,
  onChange,
  error,
  disabled,
  dictionary,
}: FieldProps & { dictionary: Dictionary }) {
  return (
    <div className="field">
      <label htmlFor="phone">{dictionary.mobileNumber}</label>
      <input
        id="phone"
        name="phone"
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={`phone-hint${error ? ' phone-error' : ''}`}
        placeholder="+12025550123"
      />
      <p id="phone-hint" className="field-hint">
        {dictionary.phoneHint}
      </p>
      {error && (
        <p id="phone-error" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function OtpField({
  value,
  onChange,
  error,
  disabled,
  dictionary,
}: FieldProps & { dictionary: Dictionary }) {
  return (
    <div className="field">
      <label htmlFor="otp">{dictionary.otpLabel}</label>
      <input
        id="otp"
        name="otp"
        className="code-input"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        pattern="[0-9]{6}"
        value={value}
        disabled={disabled}
        onChange={(event) =>
          onChange(event.target.value.replace(/\D/gu, '').slice(0, 6))
        }
        aria-invalid={Boolean(error)}
        aria-describedby={`otp-hint${error ? ' otp-error' : ''}`}
      />
      <p id="otp-hint" className="field-hint">
        {dictionary.otpHint}
      </p>
      {error && (
        <p id="otp-error" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function PinField({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
  dictionary,
}: FieldProps & { id: string; label: string; dictionary: Dictionary }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-action">
        <input
          id={id}
          name={id}
          className="code-input"
          type={visible ? 'text' : 'password'}
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={6}
          pattern="[0-9]{6}"
          value={value}
          disabled={disabled}
          onChange={(event) =>
            onChange(event.target.value.replace(/\D/gu, '').slice(0, 6))
          }
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button
          type="button"
          className="text-button"
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? dictionary.hidePin : dictionary.showPin}
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
