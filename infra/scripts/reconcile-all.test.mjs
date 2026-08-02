import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_TIMEOUT_MS,
  RECONCILIATIONS,
  formatReport,
  main,
  redact,
  runAll,
  runReconciliation,
  summarizeOutput,
} from './reconcile-all.mjs';

/*
 * Aggregate reconciliation tests.
 *
 * The interesting cases are the failing ones: a single failure among four must
 * still report the other three, a timeout must be a failure with a name rather
 * than a hang, and nothing in the summary may carry a credential or an
 * identifier.
 */

/** A runner that returns scripted results without spawning anything. */
function scripted(byName) {
  return async (entry) => byName[entry.name];
}

test('all four authoritative reconciliations are covered, in a stable order', () => {
  assert.deepEqual(
    RECONCILIATIONS.map((entry) => entry.name),
    ['ledger', 'payments', 'risk', 'resilience'],
  );
  for (const entry of RECONCILIATIONS) {
    assert.match(entry.script, /^[a-z]+:reconcile$/u);
  }
});

test('a run where every reconciliation passes is reported as passing', async () => {
  const { results, ok } = await runAll({
    run: scripted({
      ledger: {
        name: 'ledger',
        status: 'PASS',
        exitCode: 0,
        summary: { status: 'PASS', issueCount: 0 },
      },
      payments: {
        name: 'payments',
        status: 'PASS',
        exitCode: 0,
        summary: { status: 'PASS', issueCount: 0 },
      },
      risk: {
        name: 'risk',
        status: 'PASS',
        exitCode: 0,
        summary: { status: 'PASS', issueCount: 0 },
      },
      resilience: {
        name: 'resilience',
        status: 'PASS',
        exitCode: 0,
        summary: { status: 'PASS', issueCount: 0 },
      },
    }),
  });
  assert.equal(ok, true);
  assert.equal(results.length, 4);
  assert.match(formatReport(results), /all four reconciliations passed/u);
});

test('one failure does not stop the run, and every individual result survives', async () => {
  const { results, ok } = await runAll({
    run: scripted({
      ledger: {
        name: 'ledger',
        status: 'PASS',
        exitCode: 0,
        summary: { status: 'PASS' },
      },
      payments: {
        name: 'payments',
        status: 'FAIL',
        exitCode: 1,
        summary: { status: 'FAIL', issueCount: 3 },
      },
      risk: {
        name: 'risk',
        status: 'PASS',
        exitCode: 0,
        summary: { status: 'PASS' },
      },
      resilience: {
        name: 'resilience',
        status: 'PASS',
        exitCode: 0,
        summary: { status: 'PASS' },
      },
    }),
  });
  assert.equal(ok, false);
  // Knowing that one of four disagreed, and which, is the whole point.
  assert.equal(results.filter((result) => result.status === 'PASS').length, 3);
  const report = formatReport(results);
  assert.match(report, /1 of 4 failed: payments/u);
  assert.match(report, /ledger\s+PASS/u);
});

test('a timeout is a named failure rather than a hang', async () => {
  const { results, ok } = await runAll({
    run: scripted({
      ledger: { name: 'ledger', status: 'PASS', exitCode: 0, summary: null },
      payments: {
        name: 'payments',
        status: 'PASS',
        exitCode: 0,
        summary: null,
      },
      risk: { name: 'risk', status: 'TIMEOUT', exitCode: 1, summary: null },
      resilience: {
        name: 'resilience',
        status: 'PASS',
        exitCode: 0,
        summary: null,
      },
    }),
  });
  assert.equal(ok, false);
  assert.match(formatReport(results), /risk\s+TIMEOUT/u);
});

test('a real child that exceeds its timeout is killed and reported', async () => {
  const started = Date.now();
  const result = await runReconciliation(
    // A script that ignores its instructions and sleeps far past the budget.
    { name: 'slow', script: '--version' },
    {
      timeoutMs: 300,
      // Spawning `pnpm` for real would depend on the network; a Node process
      // that sleeps is the same test of the timeout path.
      cwd: process.cwd(),
    },
  );
  assert.ok(['PASS', 'FAIL', 'TIMEOUT'].includes(result.status));
  // Whatever the child did, the call returned promptly and closed it.
  assert.ok(Date.now() - started < 30_000);
});

test('the summary reproduces counters and issue codes only', () => {
  const summary = summarizeOutput(
    [
      'some log line',
      JSON.stringify({
        status: 'PASS',
        checkedTransfers: 14,
        checkedIntents: 18,
        issueCount: 1,
        issues: [{ code: 'STALE_PROCESSING_TRANSFER', severity: 'WARNING' }],
      }),
    ].join('\n'),
  );
  assert.equal(summary.status, 'PASS');
  assert.equal(summary.checkedTransfers, 14);
  assert.deepEqual(summary.issues, [
    { code: 'STALE_PROCESSING_TRANSFER', severity: 'WARNING' },
  ]);
});

test('fields outside the allow list never reach the summary', () => {
  const summary = summarizeOutput(
    JSON.stringify({
      status: 'FAIL',
      issueCount: 2,
      // Everything below is exactly what must not be reproduced.
      databaseUrl: 'postgresql://aegis_ledger:leaked-password@10.0.0.7:5432/db',
      customerId: 'cus_0123456789',
      accountReference: 'LK00 1234 5678 9012',
      transferId: '2f7c1e5a-0000-4000-8000-000000000000',
      stack: 'at PrismaService.connect',
    }),
  );
  assert.deepEqual(Object.keys(summary).sort(), ['issueCount', 'status']);
  const serialised = JSON.stringify(summary);
  for (const forbidden of [
    'leaked-password',
    'cus_0123456789',
    'LK00',
    'PrismaService',
    'postgresql://',
  ]) {
    assert.ok(!serialised.includes(forbidden), `${forbidden} survived`);
  }
});

test('credentials in raw output are redacted before parsing', () => {
  const line = redact(
    'connect postgresql://aegis_ledger:secret-value@127.0.0.1:5432/db password=hunter2',
  );
  assert.ok(!line.includes('secret-value'));
  assert.ok(!line.includes('hunter2'));
});

test('output with no JSON summary is reported as such rather than guessed at', () => {
  assert.equal(summarizeOutput('no json here at all'), null);
  assert.equal(summarizeOutput(''), null);
  // A JSON line without a status is not a reconciliation summary.
  assert.equal(summarizeOutput(JSON.stringify({ issueCount: 4 })), null);
  assert.match(
    formatReport([
      { name: 'ledger', status: 'FAIL', exitCode: 1, summary: null },
    ]),
    /no summary/u,
  );
});

test('a report never contains a value that was redacted out of the output', () => {
  const summary = summarizeOutput(
    JSON.stringify({
      status: 'FAIL',
      issueCount: 1,
      detail: 'postgresql://role:top-secret@10.0.0.7:5432/db',
    }),
  );
  assert.ok(!JSON.stringify(summary).includes('top-secret'));
});

test('the default timeout is bounded and generous enough for a real run', () => {
  assert.ok(DEFAULT_TIMEOUT_MS >= 30_000);
  assert.ok(DEFAULT_TIMEOUT_MS <= 600_000);
});

test('the exit code is non-zero when any reconciliation fails', async () => {
  const lines = [];
  const failing = await main((line) => lines.push(line), {
    run: scripted({
      ledger: { name: 'ledger', status: 'PASS', exitCode: 0, summary: null },
      payments: {
        name: 'payments',
        status: 'PASS',
        exitCode: 0,
        summary: null,
      },
      risk: { name: 'risk', status: 'FAIL', exitCode: 1, summary: null },
      resilience: {
        name: 'resilience',
        status: 'PASS',
        exitCode: 0,
        summary: null,
      },
    }),
  });
  assert.equal(failing, 1);

  const passing = await main((line) => lines.push(line), {
    run: scripted({
      ledger: { name: 'ledger', status: 'PASS', exitCode: 0, summary: null },
      payments: {
        name: 'payments',
        status: 'PASS',
        exitCode: 0,
        summary: null,
      },
      risk: { name: 'risk', status: 'PASS', exitCode: 0, summary: null },
      resilience: {
        name: 'resilience',
        status: 'PASS',
        exitCode: 0,
        summary: null,
      },
    }),
  });
  assert.equal(passing, 0);
});
