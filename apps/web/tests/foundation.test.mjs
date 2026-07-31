import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const requiredPageCopy = [
  'AEGIS SHIELD',
  'Autonomous Encrypted Grid for Inclusive Services',
  'Phase 2 REBUILD',
  'Inclusive access',
  'Protected transactions',
  'Bounded failures',
  'Recoverable by design',
  'Synthetic data only',
];

test('foundation page contains the required AEGIS platform content', async () => {
  const pageSource = await readFile(
    new URL('../src/app/page.tsx', import.meta.url),
    'utf8',
  );

  for (const expectedCopy of requiredPageCopy) {
    assert.ok(
      pageSource.includes(expectedCopy),
      `Missing required copy: ${expectedCopy}`,
    );
  }

  assert.ok(
    pageSource.includes('id="main-content"'),
    'The page must expose a skip-link target',
  );
  assert.ok(
    pageSource.includes('hackathon prototype'),
    'The prototype warning must remain visible',
  );
});

test('root layout defines AEGIS metadata without an external font dependency', async () => {
  const layoutSource = await readFile(
    new URL('../src/app/layout.tsx', import.meta.url),
    'utf8',
  );

  assert.ok(layoutSource.includes('AEGIS Shield | Secure banking foundation'));
  assert.ok(layoutSource.includes("width: 'device-width'"));
  assert.ok(
    !layoutSource.includes('next/font'),
    'The foundation must not require external font assets',
  );
});
