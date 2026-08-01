import { spawn, type ChildProcess } from 'node:child_process';

/*
 * Starting a real service from an end-to-end test, and reporting honestly when
 * it will not start.
 *
 * The previous helper spawned with `stdio: 'ignore'` and threw
 * `"${name} exited during startup."` — which is true, and useless. A Nest
 * dependency-resolution failure, a bad connection string and a port collision
 * all produce that identical sentence, so a CI failure gave no way to tell them
 * apart without re-running locally.
 *
 * The fix is to keep the child's output and show a bounded, sanitised tail. The
 * reason it was hidden in the first place is real, though: these services log
 * connection strings and are handed an environment full of tokens and
 * passwords. So nothing reaches the failure message without going through
 * `sanitiseServiceOutput` first.
 */

export const REDACTED = '[redacted]';

/** How much of a failing service's output to keep. Enough to see a stack. */
export const MAX_CAPTURED_BYTES = 16_384;
/** How much of that to actually print. Enough to see the error and its cause. */
export const MAX_REPORTED_LINES = 40;

/**
 * Environment variables whose *values* must never appear in a failure report.
 *
 * Matched by value rather than by name, because a service logs the value
 * without the name — a connection string in an error message is not written as
 * `PAYMENTS_DATABASE_URL=...`.
 */
export const SECRET_ENVIRONMENT_NAMES = [
  'POSTGRES_PASSWORD',
  'IDENTITY_DB_PASSWORD',
  'LEDGER_DB_PASSWORD',
  'PAYMENTS_DB_PASSWORD',
  'AUDIT_DB_PASSWORD',
  'REDIS_PASSWORD',
  'REDIS_URL',
  'DATABASE_URL',
  'IDENTITY_DATABASE_URL',
  'LEDGER_DATABASE_URL',
  'PAYMENTS_DATABASE_URL',
  'AUDIT_DATABASE_URL',
  'IDENTITY_INTERNAL_TOKEN',
  'LEDGER_INTERNAL_TOKEN',
  'PAYMENTS_INTERNAL_TOKEN',
  'FIELD_ENCRYPTION_KEY',
  'SERVICE_AUTH_SHARED_SECRET',
  'PAYMENTS_QR_SIGNING_KEY',
  'USSD_PROVIDER_SECRET',
] as const;

/**
 * `NAME=value`, `NAME: value` and `"name": "value"` shapes whose *name* marks
 * the value as sensitive.
 *
 * The keyword may appear anywhere in the name, including at the very start
 * (`OTP_CODE`) — an earlier version required a leading character and silently
 * missed those. An optional closing quote is allowed before the separator so
 * JSON-shaped output (`"sessionToken": "..."`) is covered too.
 */
const SENSITIVE_ASSIGNMENT =
  /([A-Za-z0-9_]*(?:PASSWORD|PASSWD|TOKEN|SECRET|SIGNING_KEY|ENCRYPTION_KEY|APIKEY|API_KEY|PIN|OTP|COOKIE|SESSION|CREDENTIAL)[A-Za-z0-9_]*["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;)}\]]+)/giu;

/** Cookie headers, in either direction. */
const COOKIE_HEADER = /\b(set-cookie|cookie)\b(\s*[:=]\s*)([^\r\n]+)/giu;

/** Credentials embedded in any URL: postgresql://user:pass@host, redis://:pass@host. */
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/@:]*)(:[^\s/@]*)?@/giu;

/**
 * ANSI colour sequences, which Nest emits and which make a CI log unreadable.
 * Built from a char code so the escape byte is not an invisible literal in
 * source — that is also what `no-control-regex` exists to prevent.
 */
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');

/**
 * Removes secret material from service output.
 *
 * Deliberately over-redacts: it is better for a diagnostic to say
 * `[redacted]` where a harmless value stood than to put a database password in
 * a public CI log. The parts that matter for diagnosis — exception class,
 * message, module and provider names, stack frames — carry no secrets and
 * survive untouched.
 */
export function sanitiseServiceOutput(
  raw: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  let text = raw;

  // 1. Exact values from the environment. This is the strongest rule: it
  //    catches a secret however it was formatted on its way into the log.
  for (const name of SECRET_ENVIRONMENT_NAMES) {
    const value = environment[name]?.trim();
    // Very short values would match far too much; they are not real secrets.
    if (value && value.length >= 8) {
      text = text.split(value).join(REDACTED);
    }
  }

  // 2. Credentials inside any URL, including ones this process never saw.
  text = text.replace(
    URL_CREDENTIALS,
    (_match, scheme: string, user: string) =>
      `${scheme}${user ? REDACTED : ''}:${REDACTED}@`,
  );

  // 3. Assignments whose name marks the value as sensitive.
  text = text.replace(
    SENSITIVE_ASSIGNMENT,
    (_match, assignment: string) => `${assignment}${REDACTED}`,
  );

  // 4. Cookie headers.
  text = text.replace(
    COOKIE_HEADER,
    (_match, header: string, separator: string) =>
      `${header}${separator}${REDACTED}`,
  );

  // 5. Strip ANSI colouring so the report is readable in a plain CI log.
  text = text.replace(ANSI_ESCAPE, '');

  return text;
}

/** Keeps the last `maxLines` non-empty lines, so the actual error is visible. */
export function tailLines(text: string, maxLines = MAX_REPORTED_LINES): string {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  const kept = lines.slice(-maxLines);
  const dropped = lines.length - kept.length;
  return dropped > 0
    ? `… ${dropped} earlier line${dropped === 1 ? '' : 's'} omitted …\n${kept.join('\n')}`
    : kept.join('\n');
}

export interface ManagedService {
  name: string;
  child: ChildProcess;
  /** Bounded, sanitised tail of everything the process has written. */
  output: () => string;
  /** Detaches listeners. Called by `stopService`; safe to call twice. */
  release: () => void;
}

export interface StartServiceOptions {
  name: string;
  /** Absolute path to the built entry point. */
  entry: string;
  /** Absolute working directory for the child. */
  cwd: string;
  environment?: NodeJS.ProcessEnv;
}

/**
 * Spawns a service and captures a bounded window of its output.
 *
 * Only the tail is retained: a service that starts successfully and then logs
 * for the rest of the suite must not accumulate megabytes in the test process.
 */
export function startService(options: StartServiceOptions): ManagedService {
  const environment = options.environment ?? process.env;
  const child = spawn(process.execPath, [options.entry], {
    cwd: options.cwd,
    env: environment,
    // 'pipe' rather than 'ignore': the whole point is to have something to
    // report. The streams are drained below so the child never blocks on a
    // full pipe buffer.
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let captured = '';
  const append = (chunk: Buffer | string) => {
    captured += String(chunk);
    if (captured.length > MAX_CAPTURED_BYTES) {
      captured = captured.slice(-MAX_CAPTURED_BYTES);
    }
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    // Removing listeners and destroying the streams is what keeps Jest from
    // reporting an open handle after the suite finishes.
    child.stdout?.off('data', append);
    child.stderr?.off('data', append);
    child.stdout?.destroy();
    child.stderr?.destroy();
  };

  return {
    name: options.name,
    child,
    output: () => tailLines(sanitiseServiceOutput(captured, environment)),
    release,
  };
}

/**
 * Waits for a service to answer, or explains why it never will.
 *
 * The failure message now names the process, its exit code and its sanitised
 * output, so the same message in CI is enough to diagnose the cause.
 */
export async function waitForService(
  service: ManagedService,
  url: string,
  options: { attempts?: number; intervalMs?: number } = {},
): Promise<void> {
  const attempts = options.attempts ?? 240;
  const intervalMs = options.intervalMs ?? 100;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (service.child.exitCode !== null || service.child.signalCode !== null) {
      throw new Error(describeExit(service));
    }
    if (await probe(url)) return;
    await new Promise((settle) => setTimeout(settle, intervalMs));
  }
  throw new Error(
    `${service.name} did not become ready within ` +
      `${Math.round((attempts * intervalMs) / 1000)}s.\n` +
      `--- ${service.name} output ---\n${service.output()}`,
  );
}

/**
 * One readiness probe.
 *
 * `connection: close` and draining the body matter: without them the readiness
 * poll leaves pooled keep-alive sockets behind, and Jest reports "did not exit
 * one second after the test run has completed" — an open handle introduced by
 * the very helper meant to make failures diagnosable.
 */
async function probe(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { headers: { connection: 'close' } });
    // Draining releases the socket rather than leaving it half-read.
    await response.arrayBuffer().catch(() => undefined);
    return response.ok;
  } catch {
    // The listener is still binding, or the process is gone; the caller's loop
    // distinguishes those by checking the child's exit code.
    return false;
  }
}

function describeExit(service: ManagedService): string {
  const { exitCode, signalCode } = service.child;
  const how =
    signalCode !== null
      ? `was terminated by ${signalCode}`
      : `exited with code ${String(exitCode)}`;
  const output = service.output();
  return (
    `${service.name} ${how} during startup.\n` +
    `--- ${service.name} output (sanitised) ---\n` +
    (output.length > 0 ? output : '(the process produced no output)')
  );
}

/**
 * Waits for the child to exit, giving up after `timeoutMs`.
 *
 * Both the timer and the exit listener are cleaned up whichever way the race
 * ends. A bare `Promise.race([once('exit'), setTimeout(...)])` leaves the loser
 * behind: a child that exits promptly still leaves a multi-second timer
 * pending, which is enough for Jest to report "did not exit one second after
 * the test run has completed".
 */
function awaitExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((settle) => {
    const done = () => {
      clearTimeout(timer);
      child.off('exit', done);
      settle();
    };
    const timer = setTimeout(done, timeoutMs);
    child.once('exit', done);
  });
}

/** Terminates a service and detaches its listeners. Safe on an exited child. */
export async function stopService(
  service: ManagedService | undefined,
): Promise<void> {
  if (!service) return;
  const { child } = service;
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await awaitExit(child, 3_000);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await awaitExit(child, 1_000);
    }
  }
  service.release();
}
