import { z } from 'zod';
import { SabclError } from '../protocol/errors.js';
import {
  SabclKeyring,
  loadPrivateIdentity,
  loadPublicIdentity,
  sabclKeyIdSchema,
  type SabclPublicIdentity,
} from '../crypto/keyring.js';
import { fromBase64Url } from '../crypto/primitives.js';
import { isFixtureMaterial } from '../testing/fixtures.js';

/*
 * Configuration loading and startup validation.
 *
 * Every private key comes from the environment. Nothing in this repository ships
 * usable production material: `.env.example` carries placeholders only, and the
 * deterministic fixtures used by tests live under `testing/` and are explicitly
 * refused when SABCL_MODE=strict, so a fixture key can never be promoted into a
 * real deployment by accident.
 */

/**
 * SABCL_MODE:
 *   strict      — all integrated calls go through the router; startup fails if
 *                 keys or routes are missing or invalid. This is what CI runs.
 *   compatible  — SABCL is configured and used when it can be, but a caller may
 *                 fall back to the existing direct internal HTTP path. Intended
 *                 for local development against a partially started stack, and
 *                 refused when NODE_ENV=production.
 *   off         — SABCL is not wired in. Existing behaviour, unchanged.
 *
 * There is no automatic downgrade from strict: a router outage in strict mode
 * surfaces as an error, never as a plaintext retry.
 */
export const SABCL_MODES = ['strict', 'compatible', 'off'] as const;
export type SabclMode = (typeof SABCL_MODES)[number];

export const sabclModeSchema = z.enum(SABCL_MODES);

const peerSchema = z
  .object({
    keyId: sabclKeyIdSchema,
    encryptionPublicKey: z.string().min(1),
    signingPublicKey: z.string().min(1),
    revoked: z.boolean().optional(),
    notAfter: z.number().int().positive().optional(),
  })
  .strict();

const peersSchema = z.array(peerSchema).min(1);

export interface SabclEnvironmentInput {
  mode: string | undefined;
  keyId: string | undefined;
  encryptionPrivateKey: string | undefined;
  signingPrivateKey: string | undefined;
  /** JSON array of peer public identities. */
  peers: string | undefined;
  routeSecret: string | undefined;
  nodeEnvironment: string;
}

export interface SabclEnvironment {
  mode: SabclMode;
  keyring: SabclKeyring;
  routeSecret: Buffer;
}

/** Values that must never appear in a strict-mode deployment. */
const PLACEHOLDER_PATTERN =
  /change-me|local-only|placeholder|example-only|not-a-secret|fixture/iu;

export function resolveMode(raw: string | undefined): SabclMode {
  const parsed = sabclModeSchema.safeParse((raw ?? 'off').trim());
  if (!parsed.success) {
    throw new SabclError(
      'SABCL_NOT_CONFIGURED',
      'SABCL_MODE must be strict, compatible or off',
    );
  }
  return parsed.data;
}

/**
 * Builds the SABCL environment, or explains precisely why it cannot.
 *
 * Returns null when the mode is `off`, which is the only case where missing
 * configuration is not an error.
 */
export function loadSabclEnvironment(
  input: SabclEnvironmentInput,
): SabclEnvironment | null {
  const mode = resolveMode(input.mode);
  if (mode === 'off') return null;

  if (mode === 'compatible' && input.nodeEnvironment === 'production') {
    throw new SabclError(
      'SABCL_NOT_CONFIGURED',
      'SABCL_MODE=compatible is refused in production; use strict',
    );
  }

  const required = (value: string | undefined, name: string): string => {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new SabclError('SABCL_NOT_CONFIGURED', `${name} is required`);
    }
    return trimmed;
  };

  const keyId = required(input.keyId, 'SABCL key identifier');
  const encryptionPrivateKey = required(
    input.encryptionPrivateKey,
    'SABCL encryption private key',
  );
  const signingPrivateKey = required(
    input.signingPrivateKey,
    'SABCL signing private key',
  );
  const routeSecretRaw = required(input.routeSecret, 'SABCL_ROUTE_SECRET');

  if (mode === 'strict') {
    // Two distinct checks, because they catch different mistakes. The pattern
    // catches a human placeholder left in an env file. The fixture check
    // catches deterministic test material, which is indistinguishable from real
    // random bytes by inspection and would otherwise pass silently.
    if (
      [encryptionPrivateKey, signingPrivateKey, routeSecretRaw].some((value) =>
        PLACEHOLDER_PATTERN.test(value),
      )
    ) {
      throw new SabclError(
        'SABCL_NOT_CONFIGURED',
        'strict mode refuses placeholder key material',
      );
    }
    if (
      isFixtureMaterial({
        keyId,
        encryptionPrivateKey,
        signingPrivateKey,
        routeSecret: routeSecretRaw,
      })
    ) {
      throw new SabclError(
        'SABCL_NOT_CONFIGURED',
        'strict mode refuses deterministic test fixture key material',
      );
    }
  }

  const routeSecret = fromBase64Url(routeSecretRaw, 'SABCL_ROUTE_SECRET');
  if (routeSecret.length < 32) {
    throw new SabclError(
      'SABCL_NOT_CONFIGURED',
      'SABCL_ROUTE_SECRET must decode to at least 32 bytes',
    );
  }

  let peers: SabclPublicIdentity[];
  try {
    peers = peersSchema
      .parse(JSON.parse(required(input.peers, 'SABCL peer key set')))
      .map(loadPublicIdentity);
  } catch (error) {
    if (error instanceof SabclError) throw error;
    throw new SabclError(
      'SABCL_NOT_CONFIGURED',
      'SABCL peer key set is not a valid JSON array of public identities',
    );
  }

  const own = loadPrivateIdentity({
    keyId,
    encryptionPrivateKey,
    signingPrivateKey,
  });

  return { mode, keyring: new SabclKeyring(own, peers), routeSecret };
}
