import { createPublicKey, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { SabclError } from '../protocol/errors.js';
import { importKey, exportRawPublicKey } from './primitives.js';

/*
 * SABCL separates the two things a service key does:
 *
 *   - an X25519 *encryption* key, which lets others send it confidential
 *     payloads, and
 *   - an Ed25519 *signing* key, which lets others attribute a message to it.
 *
 * They are separate identities so that a signing key can be rotated on a
 * compromise without invalidating in-flight encrypted material, and so that a
 * service that only needs to verify senders never has to hold decryption
 * material.
 *
 * A key identifier is `<service>.v<version>`. The version is the rotation
 * counter, which is what makes "accept the previous key while the new one rolls
 * out" expressible without ambiguity.
 */

export const KEY_ID_PATTERN = /^[a-z][a-z0-9-]*\.v[0-9]+$/u;

export const sabclKeyIdSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(KEY_ID_PATTERN, 'must be <service>.v<version>');

/** A key pair this process owns and can decrypt or sign with. */
export interface SabclPrivateIdentity {
  keyId: string;
  service: string;
  encryptionPrivateKey: KeyObject;
  encryptionPublicKey: KeyObject;
  signingPrivateKey: KeyObject;
  signingPublicKey: KeyObject;
  /** Unix seconds after which this key must not be used to originate messages. */
  notAfter?: number;
}

/** A peer's public material. */
export interface SabclPublicIdentity {
  keyId: string;
  service: string;
  encryptionPublicKey: KeyObject;
  signingPublicKey: KeyObject;
  revoked: boolean;
  notAfter?: number;
}

export function serviceOfKeyId(keyId: string): string {
  const parsed = sabclKeyIdSchema.safeParse(keyId);
  if (!parsed.success) {
    throw new SabclError('SABCL_MALFORMED', 'invalid key identifier');
  }
  return keyId.slice(0, keyId.lastIndexOf('.'));
}

export function versionOfKeyId(keyId: string): number {
  return Number(keyId.slice(keyId.lastIndexOf('.v') + 2));
}

/**
 * Abbreviates a key identifier plus a fingerprint for operator display.
 *
 * Returns `identity.v2:9f3c1a` — enough to confirm which key is live and to
 * spot a mismatch between two services, without publishing the key itself.
 */
export function abbreviateKey(identity: {
  keyId: string;
  signingPublicKey: KeyObject;
}): string {
  const raw = exportRawPublicKey(identity.signingPublicKey);
  return `${identity.keyId}:${raw.subarray(0, 3).toString('hex')}`;
}

export interface PrivateIdentityMaterial {
  keyId: string;
  encryptionPrivateKey: string;
  signingPrivateKey: string;
  notAfter?: number;
}

export interface PublicIdentityMaterial {
  keyId: string;
  encryptionPublicKey: string;
  signingPublicKey: string;
  revoked?: boolean;
  notAfter?: number;
}

export function loadPrivateIdentity(
  material: PrivateIdentityMaterial,
): SabclPrivateIdentity {
  const keyId = sabclKeyIdSchema.parse(material.keyId);
  const encryptionPrivateKey = importKey(
    material.encryptionPrivateKey,
    'x25519-private',
    'encryptionPrivateKey',
  );
  const signingPrivateKey = importKey(
    material.signingPrivateKey,
    'ed25519-private',
    'signingPrivateKey',
  );
  return {
    keyId,
    service: serviceOfKeyId(keyId),
    encryptionPrivateKey,
    // Deriving the public halves rather than accepting them separately removes
    // a class of misconfiguration where the two do not correspond.
    encryptionPublicKey: derivePublic(encryptionPrivateKey),
    signingPrivateKey,
    signingPublicKey: derivePublic(signingPrivateKey),
    notAfter: material.notAfter,
  };
}

/** Derives the public half of a private key, so the two can never disagree. */
function derivePublic(privateKey: KeyObject): KeyObject {
  return createPublicKey(privateKey);
}

export function loadPublicIdentity(
  material: PublicIdentityMaterial,
): SabclPublicIdentity {
  const keyId = sabclKeyIdSchema.parse(material.keyId);
  return {
    keyId,
    service: serviceOfKeyId(keyId),
    encryptionPublicKey: importKey(
      material.encryptionPublicKey,
      'x25519-public',
      'encryptionPublicKey',
    ),
    signingPublicKey: importKey(
      material.signingPublicKey,
      'ed25519-public',
      'signingPublicKey',
    ),
    revoked: material.revoked === true,
    notAfter: material.notAfter,
  };
}

/**
 * The set of peer identities a process will accept, plus its own key.
 *
 * Rotation is expressed by holding more than one identity for the same service:
 * the highest non-revoked, unexpired version is used to *send*, while every
 * version still present is accepted to *receive*. Retiring a key is removing it
 * from configuration; revoking one is marking it `revoked` so that it is
 * rejected immediately and loudly rather than falling back to an older key.
 */
export class SabclKeyring {
  private readonly peers = new Map<string, SabclPublicIdentity>();

  constructor(
    readonly own: SabclPrivateIdentity,
    peers: readonly SabclPublicIdentity[],
  ) {
    for (const peer of peers) {
      if (this.peers.has(peer.keyId)) {
        throw new SabclError(
          'SABCL_NOT_CONFIGURED',
          `duplicate peer key ${peer.keyId}`,
        );
      }
      this.peers.set(peer.keyId, peer);
    }
  }

  /** Looks up a peer by exact key identifier, honouring revocation and expiry. */
  peer(keyId: string, now: number): SabclPublicIdentity {
    const peer = this.peers.get(keyId);
    if (!peer) {
      throw new SabclError('SABCL_UNKNOWN_SENDER', `no peer ${keyId}`);
    }
    if (peer.revoked) {
      throw new SabclError('SABCL_KEY_REVOKED', `peer ${keyId} is revoked`);
    }
    if (peer.notAfter !== undefined && now > peer.notAfter) {
      throw new SabclError('SABCL_KEY_REVOKED', `peer ${keyId} expired`);
    }
    return peer;
  }

  /**
   * The key version a sender should address for `service` right now: the
   * highest live version. Rotation therefore takes effect for new traffic as
   * soon as the new key is configured, while older versions stay acceptable for
   * messages already in flight.
   */
  activePeerFor(service: string, now: number): SabclPublicIdentity {
    const candidates = [...this.peers.values()]
      .filter(
        (peer) =>
          peer.service === service &&
          !peer.revoked &&
          (peer.notAfter === undefined || now <= peer.notAfter),
      )
      .sort((a, b) => versionOfKeyId(b.keyId) - versionOfKeyId(a.keyId));
    const active = candidates[0];
    if (!active) {
      throw new SabclError(
        'SABCL_UNKNOWN_RECIPIENT',
        `no live key for service ${service}`,
      );
    }
    return active;
  }

  /** Every configured peer identifier, for operator display and health output. */
  peerKeyIds(): string[] {
    return [...this.peers.keys()].sort();
  }

  /** Rotation view for the operator status surface. No key material included. */
  rotationState(now: number): {
    service: string;
    active: string | null;
    accepted: string[];
    revoked: string[];
  }[] {
    const services = new Set([...this.peers.values()].map((p) => p.service));
    return [...services].sort().map((service) => {
      const all = [...this.peers.values()].filter((p) => p.service === service);
      let active: string | null = null;
      try {
        active = this.activePeerFor(service, now).keyId;
      } catch {
        active = null;
      }
      return {
        service,
        active,
        accepted: all
          .filter(
            (p) =>
              !p.revoked && (p.notAfter === undefined || now <= p.notAfter),
          )
          .map((p) => p.keyId)
          .sort(),
        revoked: all
          .filter(
            (p) => p.revoked || (p.notAfter !== undefined && now > p.notAfter),
          )
          .map((p) => p.keyId)
          .sort(),
      };
    });
  }
}
