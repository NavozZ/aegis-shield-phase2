/**
 * Tamper helpers for security tests.
 *
 * Kept here rather than duplicated per test file so that "flip one bit" means
 * exactly the same operation in every tampering test, and so the index bounds
 * are checked once.
 */

/** Returns a copy of `value` with a single bit flipped at `index`. */
export function flipBit(value: Buffer, index = 0): Buffer {
  if (index < 0 || index >= value.length) {
    throw new RangeError('flipBit index is out of range.');
  }
  const copy = Buffer.from(value);
  copy[index] = (copy[index] as number) ^ 0x01;
  return copy;
}

/** Decodes a base64url field, flips one bit, and re-encodes it. */
export function tamperBase64Url(value: string, index = 0): string {
  return flipBit(Buffer.from(value, 'base64url'), index).toString('base64url');
}
