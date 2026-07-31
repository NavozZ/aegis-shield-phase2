import { z } from 'zod';

export const API_V1_PREFIX = '/api/v1' as const;

export const correlationIdSchema = z.uuid();
export type CorrelationId = z.infer<typeof correlationIdSchema>;

export const e164PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/u, 'Phone number must use E.164 format.');
export type E164Phone = z.infer<typeof e164PhoneSchema>;

export const preferredLanguageSchema = z.enum(['EN', 'SI', 'TA']);
export type PreferredLanguage = z.infer<typeof preferredLanguageSchema>;

const deviceIdSchema = z.string().trim().min(1).max(128).optional();
const sixDigitOtpSchema = z.string().regex(/^\d{6}$/u);
const sixDigitPinSchema = z.string().regex(/^\d{6}$/u);

const weakPinValues = new Set([
  '000000',
  '111111',
  '123456',
  '234567',
  '345678',
  '456789',
  '987654',
  '876543',
  '765432',
  '654321',
  '543210',
]);

export function isWeakPrototypePin(pin: string): boolean {
  return /^(\d)\1{5}$/u.test(pin) || weakPinValues.has(pin);
}

export const securePrototypePinSchema = sixDigitPinSchema.refine(
  (pin) => !isWeakPrototypePin(pin),
  'PIN is too easy to guess.',
);

export const requestOtpSchema = z.object({
  phone: e164PhoneSchema,
  preferredLanguage: preferredLanguageSchema,
  consentAccepted: z.literal(true),
  deviceId: deviceIdSchema,
});
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

export const otpAcceptedResponseSchema = z.object({
  accepted: z.literal(true),
  challengeId: z.uuid(),
  demoOtp: sixDigitOtpSchema.optional(),
});
export type OtpAcceptedResponse = z.infer<typeof otpAcceptedResponseSchema>;

export const verifyOtpSchema = z.object({
  phone: e164PhoneSchema,
  challengeId: z.uuid(),
  otp: sixDigitOtpSchema,
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const createPinSchema = z
  .object({
    enrollmentToken: z.string().min(32).max(512),
    pin: securePrototypePinSchema,
    pinConfirmation: sixDigitPinSchema,
    deviceId: deviceIdSchema,
  })
  .refine((value) => value.pin === value.pinConfirmation, {
    message: 'PIN confirmation does not match.',
    path: ['pinConfirmation'],
  });
export type CreatePinInput = z.infer<typeof createPinSchema>;

export const pinFallbackRequestSchema = z.object({
  phone: e164PhoneSchema,
  pin: sixDigitPinSchema,
  deviceId: deviceIdSchema,
});
export type PinFallbackRequestInput = z.infer<typeof pinFallbackRequestSchema>;

export const pinFallbackLoginSchema = z.object({
  phone: e164PhoneSchema,
  pin: sixDigitPinSchema,
  challengeId: z.uuid(),
  otp: sixDigitOtpSchema,
  deviceId: deviceIdSchema,
});
export type PinFallbackLoginInput = z.infer<typeof pinFallbackLoginSchema>;

export const logoutSchema = z.object({}).strict();
export type LogoutInput = z.infer<typeof logoutSchema>;

export const maskedUserSchema = z.object({
  id: z.uuid(),
  phoneMasked: z.string().min(4).max(24),
  preferredLanguage: preferredLanguageSchema,
  kycTier: z.number().int().min(0),
  status: z.enum(['PENDING', 'ACTIVE', 'LOCKED', 'DISABLED']),
  phoneVerified: z.boolean(),
});
export type MaskedUser = z.infer<typeof maskedUserSchema>;

export const sessionResponseSchema = z.object({
  authenticated: z.literal(true),
  authenticationMethod: z.enum(['PIN_OTP', 'PASSKEY']),
  expiresAt: z.iso.datetime(),
  user: maskedUserSchema,
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

const registrationCredentialSchema = z.object({
  id: z.string().min(1).max(2048),
  rawId: z.string().min(1).max(4096).optional(),
  type: z.literal('public-key'),
  authenticatorAttachment: z.string().max(64).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
  response: z.object({
    clientDataJSON: z.string().min(1).max(16384),
    attestationObject: z.string().min(1).max(65536),
    transports: z.array(z.string().max(64)).max(16).optional(),
    authenticatorData: z.string().max(16384).optional(),
    publicKey: z.string().max(65536).optional(),
    publicKeyAlgorithm: z.number().int().optional(),
  }),
});

const authenticationCredentialSchema = z.object({
  id: z.string().min(1).max(2048),
  rawId: z.string().min(1).max(4096).optional(),
  type: z.literal('public-key'),
  authenticatorAttachment: z.string().max(64).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
  response: z.object({
    clientDataJSON: z.string().min(1).max(16384),
    authenticatorData: z.string().min(1).max(16384),
    signature: z.string().min(1).max(16384),
    userHandle: z.string().max(4096).optional(),
  }),
});

export const passkeyRegistrationOptionsSchema = z.object({}).passthrough();
export type PasskeyRegistrationOptions = z.infer<
  typeof passkeyRegistrationOptionsSchema
>;

export const passkeyRegistrationVerificationSchema = z.object({
  challenge: z.string().min(16).max(4096),
  credential: registrationCredentialSchema,
  nickname: z.string().trim().min(1).max(64).optional(),
});
export type PasskeyRegistrationVerificationInput = z.infer<
  typeof passkeyRegistrationVerificationSchema
>;

export const passkeyAuthenticationOptionsSchema = z.object({}).passthrough();
export type PasskeyAuthenticationOptions = z.infer<
  typeof passkeyAuthenticationOptionsSchema
>;

export const passkeyAuthenticationVerificationSchema = z.object({
  challenge: z.string().min(16).max(4096),
  credential: authenticationCredentialSchema,
  deviceId: deviceIdSchema,
});
export type PasskeyAuthenticationVerificationInput = z.infer<
  typeof passkeyAuthenticationVerificationSchema
>;

export const standardErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
    message: z.string().min(1).max(256),
    correlationId: correlationIdSchema,
  }),
});
export type StandardErrorResponse = z.infer<typeof standardErrorResponseSchema>;
