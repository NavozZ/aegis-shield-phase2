/**
 * Aggregate reconciliation.
 *
 *   pnpm reconcile:all
 *
 * Runs the Ledger, Payments, Risk and Resilience reconciliations in sequence and
 * reports one summary. Sequential rather than parallel on purpose: these read
 * live databases and a running Risk and Resilience service, and interleaving
 * their output would make a failure hard to attribute.
 *
 * Three properties matter here.
 *
 *   - Individual results are preserved. A single aggregated verdict would hide
 *     which subsystem disagreed with itself, which is the only useful thing to
 *     know after an incident.
 *   - The summary is sanitized. Reconciliation output can carry identifiers and
 *     connection details, so only an allow-listed set of counter fields is
 *     reproduced and every value is redacted first.
 *   - Execution is bounded. A reconciliation that hangs against an unreachable
 *     service is a failure with a diagnostic, never a job that runs forever.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function resolveRepositoryRoot(moduleUrl = import.meta.url) {
  return resolve(dirname(fileURLToPath(moduleUrl)), '..', '..');
}

/** The four authoritative reconciliations, in the order they are reported. */
export const RECONCILIATIONS = [
  { name: 'ledger', script: 'ledger:reconcile' },
  { name: 'payments', script: 'payments:reconcile' },
  { name: 'risk', script: 'risk:reconcile' },
  { name: 'resilience', script: 'resilience:reconcile' },
];

export const DEFAULT_TIMEOUT_MS = 120_000;

/** Counter fields that are safe to reproduce in a summary. */
const SAFE_SUMMARY_FIELDS = [
  'status',
  'issueCount',
  'checkedTransfers',
  'checkedIntents',
  'checkedDrills',
  'checkedBackupSets',
  'expiredControls',
];

export function redact(text) {
  return String(text)
    .replace(
      /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/@:]*)(:[^\s/@]*)?@/giu,
      '$1[redacted]@',
    )
    .replace(/(password=)[^\s&]+/giu, '$1[redacted]');
}

/**
 * Extracts a safe summary from a reconciliation's output.
 *
 * Only the last JSON line is considered, and only allow-listed counter fields
 * are copied out of it. An allow list rather than a deny list: a future
 * reconciliation that started emitting an identifier would otherwise appear in
 * an aggregated report nobody re-reviewed.
 */
export function summarizeOutput(output) {
  const lines = redact(output).trim().split(/\r?\n/u).filter(Boolean);
  for (const line of lines.reverse()) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      continue;
    if (!('status' in parsed)) continue;
    const summary = {};
    for (const field of SAFE_SUMMARY_FIELDS) {
      if (
        typeof parsed[field] === 'string' ||
        typeof parsed[field] === 'number'
      ) {
        summary[field] = parsed[field];
      }
    }
    // Issue codes are a fixed vocabulary and are the point of the report; their
    // counts and severities are copied, never any free-text detail.
    if (Array.isArray(parsed.issues)) {
      summary.issues = parsed.issues
        .filter((issue) => issue && typeof issue.code === 'string')
        .slice(0, 16)
        .map((issue) => ({
          code: issue.code.slice(0, 64),
          severity:
            typeof issue.severity === 'string' ? issue.severity : 'UNKNOWN',
        }));
    }
    return summary;
  }
  return null;
}

/** Runs one reconciliation with a bounded lifetime, closing the child either way. */
export function runReconciliation(entry, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = options.cwd ?? resolveRepositoryRoot();
  return new Promise((settle) => {
    const child = spawn('pnpm', [entry.script], {
      cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    const chunks = [];
    let size = 0;
    const collect = (chunk) => {
      // Bounded: a failing reconciliation must not be able to flood memory.
      if (size < 64_000) {
        chunks.push(chunk);
        size += chunk.length;
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // A process that ignores SIGTERM still gets closed rather than leaked.
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, timeoutMs);

    const finish = (exitCode) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString('utf8');
      settle({
        name: entry.name,
        status: timedOut ? 'TIMEOUT' : exitCode === 0 ? 'PASS' : 'FAIL',
        exitCode: exitCode ?? 1,
        summary: summarizeOutput(output),
      });
    };
    child.once('error', () => finish(1));
    child.once('close', (code) => finish(code));
  });
}

/**
 * Runs every reconciliation and preserves each individual result.
 *
 * A later failure does not stop the run: an operator needs to know whether one
 * subsystem or all four are inconsistent, and stopping at the first failure
 * would answer only half of that.
 */
export async function runAll(options = {}) {
  const run = options.run ?? runReconciliation;
  const results = [];
  for (const entry of RECONCILIATIONS) {
    results.push(await run(entry, options));
  }
  return { results, ok: results.every((result) => result.status === 'PASS') };
}

export function formatReport(results) {
  const width = Math.max(...results.map((result) => result.name.length));
  const lines = ['[reconcile] results:'];
  for (const result of results) {
    const counts = result.summary
      ? Object.entries(result.summary)
          .filter(([key]) => key !== 'status' && key !== 'issues')
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(' ')
      : 'no summary';
    lines.push(
      `  ${result.name.padEnd(width)}  ${result.status.padEnd(7)}  ${counts}`,
    );
    for (const issue of result.summary?.issues ?? []) {
      lines.push(`  ${' '.repeat(width)}  ${issue.severity} ${issue.code}`);
    }
  }
  const failed = results.filter((result) => result.status !== 'PASS');
  lines.push(
    failed.length === 0
      ? '[reconcile] all four reconciliations passed'
      : `[reconcile] ${String(failed.length)} of ${String(results.length)} failed: ${failed
          .map((result) => result.name)
          .join(', ')}`,
  );
  return lines.join('\n');
}

export async function main(log = console.log, options = {}) {
  const { results, ok } = await runAll(options);
  log(formatReport(results));
  return ok ? 0 : 1;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (invokedPath === import.meta.url) {
  main().then((code) => {
    process.exitCode = code;
  });
}
