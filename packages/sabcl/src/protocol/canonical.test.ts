import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalEncode, canonicalUInt } from './canonical.js';

test('length prefixing makes field splices unambiguous', () => {
  // The property that matters: no two distinct field vectors share an encoding.
  // A naive concatenation would make ["ab","c"] and ["a","bc"] identical.
  assert.notDeepEqual(
    canonicalEncode(['ab', 'c']),
    canonicalEncode(['a', 'bc']),
  );
  assert.notDeepEqual(canonicalEncode(['a']), canonicalEncode(['a', '']));
  assert.notDeepEqual(canonicalEncode([]), canonicalEncode(['']));
});

test('encoding is stable across calls and buffer/string equivalence', () => {
  assert.deepEqual(canonicalEncode(['x', 'y']), canonicalEncode(['x', 'y']));
  assert.deepEqual(
    canonicalEncode(['x']),
    canonicalEncode([Buffer.from('x', 'utf8')]),
  );
});

test('integers encode fixed width so 1 and 10 cannot be confused by prefix', () => {
  assert.equal(canonicalUInt(1).length, 8);
  assert.equal(canonicalUInt(10).length, 8);
  assert.notDeepEqual(canonicalUInt(1), canonicalUInt(10));
});

test('rejects integers that cannot round-trip', () => {
  assert.throws(() => canonicalUInt(-1), RangeError);
  assert.throws(() => canonicalUInt(1.5), RangeError);
  assert.throws(() => canonicalUInt(Number.MAX_VALUE), RangeError);
});
