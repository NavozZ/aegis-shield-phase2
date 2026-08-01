/**
 * SABCL wire constants.
 *
 * Every value here is part of the on-the-wire contract. Changing one without
 * bumping {@link SABCL_PROTOCOL_VERSION} will silently break interoperability
 * between a sender and a recipient running different builds, so treat this file
 * as append-mostly.
 */

/** Version string carried in the `v` field of every envelope. */
export const SABCL_PROTOCOL_VERSION = 'SABCL/1' as const;

/**
 * Domain separation tags. Each derived key, signature and token uses a distinct
 * label so material produced for one purpose can never be replayed as material
 * for another.
 */
export const SABCL_DOMAIN = {
  requestKey: 'SABCL/1 request-key',
  responseKey: 'SABCL/1 response-key',
  requestSignature: 'SABCL/1 request-signature',
  responseSignature: 'SABCL/1 response-signature',
  routeToken: 'SABCL/1 route-token',
  serviceHandle: 'SABCL/1 service-handle',
} as const;

/** AES-256-GCM: 32-byte key, 96-bit nonce, 128-bit tag. */
export const SABCL_KEY_BYTES = 32;
export const SABCL_NONCE_BYTES = 12;
export const SABCL_TAG_BYTES = 16;

/** Message identifiers are 128 bits of CSPRNG output, base64url encoded. */
export const SABCL_MESSAGE_ID_BYTES = 16;

/** Route tokens are 256-bit HMAC outputs, base64url encoded. */
export const SABCL_ROUTE_TOKEN_BYTES = 32;

/**
 * Bounded message size. The plaintext ceiling is enforced before padding and
 * the envelope ceiling is enforced by the router before any cryptography runs,
 * so an oversized message is rejected cheaply.
 */
export const SABCL_MAX_PLAINTEXT_BYTES = 65_536;
export const SABCL_MAX_ENVELOPE_BYTES = 262_144;

/** Bounded hop count. A hop limit outside this range is rejected as malformed. */
export const SABCL_MAX_HOP_LIMIT = 4;
export const SABCL_DEFAULT_HOP_LIMIT = 2;

/**
 * Bounded lifetime. Short expiry windows keep the replay window — and therefore
 * the replay-state retention — small.
 */
export const SABCL_MAX_TTL_SECONDS = 120;
export const SABCL_DEFAULT_TTL_SECONDS = 30;

/**
 * Tolerance for clock skew between services when checking `iat`. Expiry itself
 * is never extended by this allowance.
 */
export const SABCL_CLOCK_SKEW_SECONDS = 5;
