/**
 * Canonical, unambiguous encoding for material that is signed or authenticated.
 *
 * JSON is not used here. Two different JSON documents can carry the same field
 * values (key order, whitespace, unicode escapes), and a canonicalising JSON
 * serialiser has to defend against every one of those. A length-prefixed
 * encoding has exactly one representation per field vector by construction, so
 * a splice of `"a" + "bc"` can never collide with `"ab" + "c"`.
 */

/**
 * Encodes an ordered vector of fields as `uint32be(length) || bytes` per field.
 *
 * Field order is positional and fixed by the caller; it is part of the
 * protocol, not a property of the data.
 */
export function canonicalEncode(fields: readonly (string | Buffer)[]): Buffer {
  const parts: Buffer[] = [];
  for (const field of fields) {
    const bytes = Buffer.isBuffer(field) ? field : Buffer.from(field, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length, 0);
    parts.push(length, bytes);
  }
  return Buffer.concat(parts);
}

/** Encodes a non-negative integer as a fixed-width decimal-free 8-byte field. */
export function canonicalUInt(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      'Canonical integers must be non-negative safe integers.',
    );
  }
  const buffer = Buffer.allocUnsafe(8);
  buffer.writeBigUInt64BE(BigInt(value), 0);
  return buffer;
}
