import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const QR_PROTOCOL_VERSION = 1;

export interface QrPayloadData {
  version: number;
  recipientRef: string;
  currency: string;
  amountMinor?: string;
  nonce: string;
  expiresAt: string;
  type: 'STATIC' | 'DYNAMIC';
  purpose?: string;
  keyId: string;
}

export interface SignedQrPayload extends QrPayloadData {
  signature: string;
}

/**
 * Generate a cryptographically random nonce for QR replay protection.
 */
export function generateQrNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Generate a QR payment reference: AEGIS-QRP-XXXX-XXXX-XXXX
 */
export function newQrPaymentReference(): string {
  const value = randomBytes(12).toString('hex').toUpperCase();
  return `AEGIS-QRP-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
}

/**
 * SHA-256 hash utility.
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Sign a QR payload using HMAC-SHA256.
 * Only the minimum data required for validation is included in the outer payload.
 */
export function signQrPayload(
  data: QrPayloadData,
  signingKey: string,
): SignedQrPayload {
  const canonical = canonicalPayloadString(data);
  const signature = createHmac('sha256', signingKey)
    .update(canonical)
    .digest('hex');
  return { ...data, signature };
}

/**
 * Verify a signed QR payload.
 */
export function verifyQrSignature(
  payload: SignedQrPayload,
  signingKey: string,
): boolean {
  const { signature, ...data } = payload;
  const canonical = canonicalPayloadString(data);
  const expected = createHmac('sha256', signingKey)
    .update(canonical)
    .digest('hex');
  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || sigBuf.length === 0) return false;
  return timingSafeEqual(sigBuf, expBuf);
}

/**
 * Encode a signed QR payload to a compact string for QR code generation.
 * Format: base64url-encoded JSON.
 */
export function encodeQrPayload(payload: SignedQrPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Decode a QR payload string back to a SignedQrPayload object.
 * Returns null for malformed payloads.
 */
export function decodeQrPayload(encoded: string): SignedQrPayload | null {
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (!isSignedQrPayload(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isSignedQrPayload(value: unknown): value is SignedQrPayload {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.version === 'number' &&
    typeof obj.recipientRef === 'string' &&
    typeof obj.currency === 'string' &&
    typeof obj.nonce === 'string' &&
    typeof obj.expiresAt === 'string' &&
    typeof obj.type === 'string' &&
    (obj.type === 'STATIC' || obj.type === 'DYNAMIC') &&
    typeof obj.signature === 'string' &&
    typeof obj.keyId === 'string' &&
    (obj.amountMinor === undefined || typeof obj.amountMinor === 'string') &&
    (obj.purpose === undefined || typeof obj.purpose === 'string')
  );
}

function canonicalPayloadString(data: QrPayloadData): string {
  const entries: Array<[string, string]> = [
    ['currency', data.currency],
    ['expiresAt', data.expiresAt],
    ['keyId', data.keyId],
    ['nonce', data.nonce],
    ['recipientRef', data.recipientRef],
    ['type', data.type],
    ['version', String(data.version)],
  ];
  if (data.amountMinor !== undefined) {
    entries.push(['amountMinor', data.amountMinor]);
  }
  if (data.purpose !== undefined) {
    entries.push(['purpose', data.purpose]);
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
}
