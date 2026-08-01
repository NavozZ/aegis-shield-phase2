/**
 * SABCL failure taxonomy.
 *
 * These codes are deliberately coarse. They describe what the *protocol* layer
 * rejected, never what the business layer would have found: a message addressed
 * to a customer that does not exist and a message addressed to a customer that
 * does exist fail identically here. Callers outside the recipient service must
 * not be able to distinguish the two.
 */
export const SABCL_ERROR_CODES = [
  'SABCL_MALFORMED',
  'SABCL_UNSUPPORTED_VERSION',
  'SABCL_OVERSIZED',
  'SABCL_EXPIRED',
  'SABCL_REPLAYED',
  'SABCL_SIGNATURE_INVALID',
  'SABCL_DECRYPTION_FAILED',
  'SABCL_UNKNOWN_SENDER',
  'SABCL_UNKNOWN_RECIPIENT',
  'SABCL_KEY_REVOKED',
  'SABCL_ROUTE_INVALID',
  'SABCL_HOP_LIMIT_EXCEEDED',
  'SABCL_RECIPIENT_UNAVAILABLE',
  'SABCL_NOT_CONFIGURED',
] as const;

export type SabclErrorCode = (typeof SABCL_ERROR_CODES)[number];

/**
 * A protocol-layer failure.
 *
 * `message` is a fixed string derived from the code and is safe to log or to
 * return over the wire. Anything that could describe the rejected material —
 * a key identifier, a route token, a plaintext fragment — belongs in
 * {@link SabclError.detail}, which is for local diagnostics only and is never
 * serialised into a response.
 */
export class SabclError extends Error {
  readonly code: SabclErrorCode;
  readonly detail?: string;

  constructor(code: SabclErrorCode, detail?: string) {
    super(code);
    this.name = 'SabclError';
    this.code = code;
    this.detail = detail;
  }

  /** The only representation that may cross a process boundary. */
  toSafeResponse(): { error: { code: SabclErrorCode } } {
    return { error: { code: this.code } };
  }
}

/**
 * Normalises any thrown value into a {@link SabclError}.
 *
 * Unknown failures collapse to `SABCL_DECRYPTION_FAILED` rather than leaking a
 * runtime message, because in practice an unexpected throw inside seal/open is
 * a cryptographic failure and should be indistinguishable from a deliberate
 * tamper attempt.
 */
export function toSabclError(
  error: unknown,
  fallback: SabclErrorCode = 'SABCL_DECRYPTION_FAILED',
): SabclError {
  return error instanceof SabclError ? error : new SabclError(fallback);
}
