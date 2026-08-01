import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import {
  SabclKeyring,
  loadPrivateIdentity,
  loadPublicIdentity,
  type SabclPrivateIdentity,
  type SabclPublicIdentity,
} from '../crypto/keyring.js';
import { exportRawPublicKey, toBase64Url } from '../crypto/primitives.js';

/*
 * DETERMINISTIC NON-PRODUCTION KEY MATERIAL.
 *
 * Keys are derived from a fixed label with SHA-256, so a test run produces the
 * same identities every time and a failure is reproducible. That determinism is
 * precisely why this material is worthless outside a test: anybody reading this
 * file can regenerate every private key in it.
 *
 * Two safeguards keep it out of a real deployment:
 *   1. nothing here is written to `.env.example` or to any committed .env, and
 *   2. `loadSabclEnvironment` calls {@link isFixtureMaterial} in strict mode and
 *      refuses to start on a match.
 *
 * Note that the second check cannot be a string pattern: the derived material is
 * indistinguishable from real random bytes by inspection. It works by
 * recomputing the fixture scalar for the key identifier being configured and
 * comparing — which is possible precisely because these keys are deterministic.
 *
 * Do not add a helper that emits these into environment variables.
 */

const FIXTURE_PREFIX = 'aegis-sabcl-fixture';

/** Derives a deterministic 32-byte scalar for a labelled fixture key. */
function fixtureScalar(label: string): Buffer {
  return createHash('sha256').update(`${FIXTURE_PREFIX}|${label}`).digest();
}

function fixturePrivate(
  label: string,
  curve: 'x25519' | 'ed25519',
): { privateBase64Url: string; publicBase64Url: string } {
  const raw = fixtureScalar(`${label}|${curve}`);
  // X25519 secret scalars are clamped by the standard; doing it here means the
  // derived key round-trips through Node's importer unchanged.
  if (curve === 'x25519') {
    raw[0] = (raw[0] as number) & 248;
    raw[31] = (((raw[31] as number) & 127) | 64) as number;
  }
  const prefix =
    curve === 'x25519'
      ? Buffer.from('302e020100300506032b656e04220420', 'hex')
      : Buffer.from('302e020100300506032b657004220420', 'hex');
  const privateKey = createPrivateKey({
    key: Buffer.concat([prefix, raw]),
    format: 'der',
    type: 'pkcs8',
  });
  return {
    privateBase64Url: toBase64Url(raw),
    publicBase64Url: toBase64Url(
      exportRawPublicKey(createPublicKey(privateKey)),
    ),
  };
}

export interface FixtureIdentityMaterial {
  keyId: string;
  encryptionPrivateKey: string;
  signingPrivateKey: string;
  encryptionPublicKey: string;
  signingPublicKey: string;
}

/** Deterministic material for `<service>.v<version>`. */
export function fixtureIdentityMaterial(
  service: string,
  version = 1,
): FixtureIdentityMaterial {
  const label = `${service}.v${version}`;
  const encryption = fixturePrivate(label, 'x25519');
  const signing = fixturePrivate(label, 'ed25519');
  return {
    keyId: label,
    encryptionPrivateKey: encryption.privateBase64Url,
    signingPrivateKey: signing.privateBase64Url,
    encryptionPublicKey: encryption.publicBase64Url,
    signingPublicKey: signing.publicBase64Url,
  };
}

export function fixturePrivateIdentity(
  service: string,
  version = 1,
): SabclPrivateIdentity {
  const material = fixtureIdentityMaterial(service, version);
  return loadPrivateIdentity({
    keyId: material.keyId,
    encryptionPrivateKey: material.encryptionPrivateKey,
    signingPrivateKey: material.signingPrivateKey,
  });
}

export function fixturePublicIdentity(
  service: string,
  version = 1,
  options: { revoked?: boolean; notAfter?: number } = {},
): SabclPublicIdentity {
  const material = fixtureIdentityMaterial(service, version);
  return loadPublicIdentity({
    keyId: material.keyId,
    encryptionPublicKey: material.encryptionPublicKey,
    signingPublicKey: material.signingPublicKey,
    revoked: options.revoked,
    notAfter: options.notAfter,
  });
}

/** A keyring owned by `service` that trusts every listed peer. */
export function fixtureKeyring(
  service: string,
  peers: readonly (
    | string
    | {
        service: string;
        version?: number;
        revoked?: boolean;
        notAfter?: number;
      }
  )[],
  version = 1,
): SabclKeyring {
  return new SabclKeyring(
    fixturePrivateIdentity(service, version),
    peers.map((peer) =>
      typeof peer === 'string'
        ? fixturePublicIdentity(peer)
        : fixturePublicIdentity(peer.service, peer.version ?? 1, {
            revoked: peer.revoked,
            notAfter: peer.notAfter,
          }),
    ),
  );
}

/** Deterministic 32-byte route secret. Test use only. */
export const FIXTURE_ROUTE_SECRET = fixtureScalar('route-secret');

/**
 * Detects fixture key material.
 *
 * Recomputes what a fixture for `keyId` would be and compares it to what was
 * supplied. Because the fixtures are deterministic, this catches them exactly —
 * for any service name, without a maintained denylist — while never producing a
 * false positive on genuinely random material.
 *
 * Called by `loadSabclEnvironment` when SABCL_MODE=strict. That is the one
 * place a fixture key could otherwise reach a real deployment.
 */
export function isFixtureMaterial(material: {
  keyId?: string;
  encryptionPrivateKey?: string;
  signingPrivateKey?: string;
  routeSecret?: string;
}): boolean {
  if (
    material.routeSecret !== undefined &&
    material.routeSecret === toBase64Url(FIXTURE_ROUTE_SECRET)
  ) {
    return true;
  }
  if (!material.keyId) return false;
  const expected = (() => {
    try {
      const [service, version] = splitKeyId(material.keyId);
      return fixtureIdentityMaterial(service, version);
    } catch {
      return undefined;
    }
  })();
  if (!expected) return false;
  return (
    material.encryptionPrivateKey === expected.encryptionPrivateKey ||
    material.signingPrivateKey === expected.signingPrivateKey
  );
}

function splitKeyId(keyId: string): [string, number] {
  const separator = keyId.lastIndexOf('.v');
  if (separator <= 0) throw new Error('not a key identifier');
  const version = Number(keyId.slice(separator + 2));
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new Error('not a key identifier');
  }
  return [keyId.slice(0, separator), version];
}
