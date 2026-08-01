import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryReplayStore } from './replay-store.js';

test('a message identifier is accepted once and refused thereafter', async () => {
  const store = new InMemoryReplayStore();
  assert.equal(await store.remember('mid-1', 30), true);
  assert.equal(await store.remember('mid-1', 30), false);
  assert.equal(await store.remember('mid-1', 30), false);
});

test('distinct identifiers do not interfere', async () => {
  const store = new InMemoryReplayStore();
  assert.equal(await store.remember('a', 30), true);
  assert.equal(await store.remember('b', 30), true);
});

test('concurrent duplicates admit exactly one winner', async () => {
  // The duplicate-submission case: two copies of the same envelope racing.
  // Exactly one must be accepted, or a transfer could post twice.
  const store = new InMemoryReplayStore();
  const results = await Promise.all(
    Array.from({ length: 32 }, () => store.remember('racing', 30)),
  );
  assert.equal(results.filter(Boolean).length, 1);
});

test('entries expire so retention stays bounded by the protocol TTL', async () => {
  const store = new InMemoryReplayStore();
  assert.equal(await store.remember('short', 1), true);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  // Once the window has passed the identifier is forgettable; the envelope that
  // used it is itself expired by then, so this does not reopen a replay window.
  assert.equal(await store.remember('short', 1), true);
});

test('expired entries are swept rather than accumulating', async () => {
  const store = new InMemoryReplayStore();
  await store.remember('gone', 1);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  await store.remember('fresh', 30);
  assert.equal(store.size(), 1);
});
