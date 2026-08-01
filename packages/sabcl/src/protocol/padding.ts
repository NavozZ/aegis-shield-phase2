import { SabclError } from './errors.js';
import { paddingBucketFor } from './envelope.js';
import { SABCL_MAX_PLAINTEXT_BYTES } from './version.js';

/*
 * Padded plaintext layout:
 *
 *   uint32be(actualLength) || payload || zero-fill to the bucket size
 *
 * The length prefix is inside the AEAD, so an attacker cannot resize a payload
 * without failing authentication. Padding is applied before encryption, which
 * is why the ciphertext length reveals only the bucket.
 */

const LENGTH_PREFIX_BYTES = 4;

export function padPayload(payload: Buffer): {
  padded: Buffer;
  bucket: number;
} {
  if (payload.length > SABCL_MAX_PLAINTEXT_BYTES) {
    throw new SabclError(
      'SABCL_OVERSIZED',
      'payload exceeds plaintext ceiling',
    );
  }
  const bucket = paddingBucketFor(payload.length + LENGTH_PREFIX_BYTES);
  const padded = Buffer.alloc(bucket);
  padded.writeUInt32BE(payload.length, 0);
  payload.copy(padded, LENGTH_PREFIX_BYTES);
  return { padded, bucket };
}

export function unpadPayload(padded: Buffer): Buffer {
  if (padded.length < LENGTH_PREFIX_BYTES) {
    throw new SabclError('SABCL_MALFORMED', 'padded payload is too short');
  }
  const length = padded.readUInt32BE(0);
  if (length > padded.length - LENGTH_PREFIX_BYTES) {
    throw new SabclError(
      'SABCL_MALFORMED',
      'padded length prefix is out of range',
    );
  }
  return padded.subarray(LENGTH_PREFIX_BYTES, LENGTH_PREFIX_BYTES + length);
}
