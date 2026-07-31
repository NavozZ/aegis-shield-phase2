import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPinSchema,
  e164PhoneSchema,
  passkeyAuthenticationVerificationSchema,
  preferredLanguageSchema,
  requestOtpSchema,
} from './v1.js';

test('accepts normalized E.164 phone input', () => {
  assert.equal(e164PhoneSchema.parse('+94771234567'), '+94771234567');
});

test('rejects local, formatted, and overlong phone input', () => {
  for (const phone of ['0771234567', '+94 77 123 4567', '+1234567890123456']) {
    assert.equal(e164PhoneSchema.safeParse(phone).success, false);
  }
});

test('accepts only supported preferred languages', () => {
  assert.equal(preferredLanguageSchema.parse('SI'), 'SI');
  assert.equal(preferredLanguageSchema.safeParse('FR').success, false);
});

test('requires explicit onboarding consent', () => {
  const result = requestOtpSchema.safeParse({
    phone: '+94771234567',
    preferredLanguage: 'EN',
    consentAccepted: false,
  });
  assert.equal(result.success, false);
});

test('requires matching PIN confirmation', () => {
  const result = createPinSchema.safeParse({
    enrollmentToken: 'a'.repeat(32),
    pin: '739182',
    pinConfirmation: '739183',
  });
  assert.equal(result.success, false);
});

test('rejects repeated, ascending, descending, and common PINs', () => {
  for (const pin of ['000000', '111111', '123456', '654321']) {
    const result = createPinSchema.safeParse({
      enrollmentToken: 'a'.repeat(32),
      pin,
      pinConfirmation: pin,
    });
    assert.equal(result.success, false);
  }
});

test('accepts a non-sequential six-digit PIN', () => {
  assert.equal(
    createPinSchema.safeParse({
      enrollmentToken: 'a'.repeat(32),
      pin: '739182',
      pinConfirmation: '739182',
    }).success,
    true,
  );
});

test('rejects malformed passkey authentication payloads', () => {
  assert.equal(
    passkeyAuthenticationVerificationSchema.safeParse({
      challenge: 'short',
      credential: { id: '', type: 'password', response: {} },
    }).success,
    false,
  );
});
