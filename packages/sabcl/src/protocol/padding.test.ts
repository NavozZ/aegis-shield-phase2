import assert from 'node:assert/strict';
import test from 'node:test';
import { padPayload, unpadPayload } from './padding.js';
import { SABCL_PADDING_BUCKETS, paddingBucketFor } from './envelope.js';
import { SabclError } from './errors.js';
import { SABCL_MAX_PLAINTEXT_BYTES } from './version.js';

test('padding round-trips exactly, including empty and boundary payloads', () => {
  for (const length of [0, 1, 507, 508, 509, 1_000, 4_000]) {
    const payload = Buffer.alloc(length, 0xab);
    const { padded, bucket } = padPayload(payload);
    assert.equal(padded.length, bucket);
    assert.deepEqual(unpadPayload(padded), payload);
  }
});

test('padded output is always exactly a declared bucket size', () => {
  for (const length of [0, 1, 100, 600, 5_000, 40_000]) {
    const { bucket } = padPayload(Buffer.alloc(length));
    assert.ok(
      (SABCL_PADDING_BUCKETS as readonly number[]).includes(bucket),
      `${bucket} is not a declared bucket`,
    );
  }
});

test('buckets are chosen as the smallest that fits, including the length prefix', () => {
  // 508 bytes of payload plus the 4-byte prefix is exactly 512.
  assert.equal(padPayload(Buffer.alloc(508)).bucket, 512);
  // One more byte must step up to the next bucket rather than overflow.
  assert.equal(padPayload(Buffer.alloc(509)).bucket, 1_024);
});

test('different payload lengths inside one bucket are indistinguishable by size', () => {
  const short = padPayload(Buffer.alloc(10)).padded.length;
  const long = padPayload(Buffer.alloc(400)).padded.length;
  assert.equal(short, long);
});

test('padding beyond the largest bucket is refused', () => {
  assert.throws(
    () => padPayload(Buffer.alloc(SABCL_MAX_PLAINTEXT_BYTES + 1)),
    SabclError,
  );
  assert.throws(() => paddingBucketFor(1_000_000), RangeError);
});

test('a corrupted length prefix is rejected rather than over-reading', () => {
  const { padded } = padPayload(Buffer.from('short'));
  const corrupted = Buffer.from(padded);
  corrupted.writeUInt32BE(padded.length, 0);
  assert.throws(() => unpadPayload(corrupted), SabclError);
});

test('a truncated padded buffer is rejected', () => {
  assert.throws(() => unpadPayload(Buffer.alloc(2)), SabclError);
});

test('padding bytes are zero, so no residual memory is carried into ciphertext', () => {
  const { padded } = padPayload(Buffer.from('abc'));
  assert.deepEqual(padded.subarray(7), Buffer.alloc(padded.length - 7));
});
