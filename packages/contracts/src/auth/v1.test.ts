import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPinSchema,
  e164PhoneSchema,
  enrollmentResponseSchema,
  logoutResponseSchema,
  passkeyAuthenticationOptionsSchema,
  passkeyAuthenticationOptionsResponseSchema,
  passkeyAuthenticationVerificationSchema,
  passkeyRegistrationOptionsSchema,
  passkeyRegistrationOptionsResponseSchema,
  passkeyVerifiedResponseSchema,
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

test('requires a bounded challenge in passkey option responses', () => {
  for (const schema of [
    passkeyRegistrationOptionsResponseSchema,
    passkeyAuthenticationOptionsResponseSchema,
  ]) {
    assert.equal(schema.safeParse({}).success, false);
    assert.equal(
      schema.safeParse({ challenge: 'challenge-value-long-enough' }).success,
      true,
    );
  }
});

test('accepts empty passkey options requests', () => {
  for (const schema of [
    passkeyRegistrationOptionsSchema,
    passkeyAuthenticationOptionsSchema,
  ]) {
    assert.equal(schema.safeParse({}).success, true);
  }
});

test('validates browser-facing enrollment and completion responses', () => {
  const user = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    phoneMasked: '+94******567',
    preferredLanguage: 'EN',
    kycTier: 0,
    status: 'ACTIVE',
    phoneVerified: true,
  };
  assert.equal(
    enrollmentResponseSchema.safeParse({
      enrollmentToken: 'a'.repeat(32),
      expiresInSeconds: 600,
      user,
    }).success,
    true,
  );
  assert.deepEqual(passkeyVerifiedResponseSchema.parse({ verified: true }), {
    verified: true,
  });
  assert.deepEqual(logoutResponseSchema.parse({ revoked: true }), {
    revoked: true,
  });
});
