/**
 * One-command demonstration orchestration.
 *
 *   pnpm demo:start          infrastructure, migrations and every service
 *   pnpm demo:status         what is listening, and what is not
 *   pnpm demo:verify         liveness, readiness and response-shape checks
 *   pnpm demo:stop           stop the services and the containers, keep the data
 *   pnpm demo:reset -- --yes destroy the local volumes, on explicit confirmation
 *
 * Design constraints this file exists to satisfy:
 *
 *   - Nothing is printed that could carry a credential. Service rows show a
 *     name, a port and a state; probe failures show a status, never a URL with
 *     userinfo and never a response body.
 *   - Every wait is bounded and every readiness check polls an endpoint rather
 *     than sleeping for a guessed interval.
 *   - Ctrl+C stops every child in reverse start order and waits for it, so no
 *     orphan keeps a port bound.
 *   - Normal shutdown never deletes data. Only `reset --yes` does, and it says
 *     so first.
 *   - Everything is plain Node with argument arrays; no shell string is ever
 *     built from configuration.
 *
 * The orchestration logic, failure handling and formatting below are pure
 * functions so they can be tested on a machine with no Docker engine.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export class DemoUsageError extends Error {}

export function resolveRepositoryRoot(moduleUrl = import.meta.url) {
  return resolve(dirname(fileURLToPath(moduleUrl)), '..', '..');
}

const SUPPORTED_COMMANDS = new Set([
  'start',
  'status',
  'verify',
  'stop',
  'reset',
]);

/**
 * The demonstration stack, in start order.
 *
 * Order is not cosmetic: the blind router comes up after the services it
 * forwards to and before the gateway that sends through it, so a strict-mode
 * gateway starts with a reachable router rather than failing its first call.
 */
export const DEMO_SERVICES = [
  {
    name: 'Identity',
    portVariable: 'IDENTITY_SERVICE_PORT',
    defaultPort: 4101,
    entry: ['services', 'identity', 'dist', 'main.js'],
    cwd: ['services', 'identity'],
    live: '/health/live',
  },
  {
    name: 'Ledger',
    portVariable: 'LEDGER_SERVICE_PORT',
    defaultPort: 4102,
    entry: ['services', 'ledger', 'dist', 'main.js'],
    cwd: ['services', 'ledger'],
    live: '/health/live',
  },
  {
    name: 'SABCL router',
    portVariable: 'SABCL_ROUTER_PORT',
    defaultPort: 4103,
    entry: ['services', 'sabcl-router', 'dist', 'main.js'],
    cwd: ['services', 'sabcl-router'],
    live: '/health/live',
    // Nothing to route when SABCL is off, and the router refuses to start in
    // that case, so it is skipped rather than reported as broken.
    optionalWhen: (environment) =>
      (environment.SABCL_MODE || 'off').trim() === 'off',
  },
  {
    name: 'Payments',
    portVariable: 'PAYMENTS_SERVICE_PORT',
    defaultPort: 4104,
    entry: ['services', 'payments', 'dist', 'main.js'],
    cwd: ['services', 'payments'],
    live: '/health/live',
  },
  {
    name: 'Risk',
    portVariable: 'RISK_SERVICE_PORT',
    defaultPort: 4105,
    entry: ['services', 'risk', 'dist', 'main.js'],
    cwd: ['services', 'risk'],
    live: '/health/live',
  },
  {
    name: 'Resilience',
    portVariable: 'RESILIENCE_SERVICE_PORT',
    defaultPort: 4106,
    entry: ['services', 'resilience', 'dist', 'main.js'],
    cwd: ['services', 'resilience'],
    live: '/health/live',
    ready: '/health/ready',
  },
  {
    name: 'Gateway',
    portVariable: 'API_GATEWAY_PORT',
    defaultPort: 4000,
    entry: ['apps', 'api-gateway', 'dist', 'main.js'],
    cwd: ['apps', 'api-gateway'],
    live: '/health',
    ready: '/health/ready',
  },
  {
    name: 'Web',
    portVariable: 'WEB_PORT',
    defaultPort: 3000,
    entry: ['apps', 'web', 'node_modules', 'next', 'dist', 'bin', 'next'],
    cwd: ['apps', 'web'],
    argumentsFor: (port) => ['start', '--port', String(port)],
    live: '/',
    expectsJson: false,
  },
];

/** Variables whose values must never appear in demo output. */
export const SECRET_VARIABLE_PATTERN =
  /PASSWORD|TOKEN|SECRET|PRIVATE_KEY|_KEY$|DATABASE_URL|REDIS_URL/u;

export function parseCliArguments(argumentsList) {
  const [command, ...rest] = argumentsList;
  if (!SUPPORTED_COMMANDS.has(command)) {
    throw new DemoUsageError(
      'Unsupported demo command. Use start, status, verify, stop, or reset.',
    );
  }
  let confirmed = false;
  for (const argument of rest) {
    if (argument === '--yes') {
      confirmed = true;
      continue;
    }
    throw new DemoUsageError('Unsupported argument.');
  }
  if (command === 'reset' && !confirmed) {
    throw new DemoUsageError(
      'Refusing to destroy local data without explicit confirmation. ' +
        'Re-run: pnpm demo:reset -- --yes',
    );
  }
  return { command, confirmed };
}

export function parseEnvironmentFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

export function loadEnvironment(repositoryRoot, base = process.env) {
  return {
    ...parseEnvironmentFile(resolve(repositoryRoot, '.env.example')),
    ...parseEnvironmentFile(resolve(repositoryRoot, '.env')),
    ...base,
  };
}

/**
 * Builds the redaction list from the environment.
 *
 * Values are collected by variable NAME pattern, so a token that happens to look
 * like ordinary text is still redacted. Very short values are skipped: replacing
 * every occurrence of a two-character value would corrupt unrelated output.
 */
export function collectSecrets(environment) {
  const secrets = [];
  for (const [name, value] of Object.entries(environment)) {
    if (!SECRET_VARIABLE_PATTERN.test(name)) continue;
    if (typeof value !== 'string' || value.length < 8) continue;
    secrets.push(value);
  }
  return secrets;
}

export function redact(text, secrets) {
  let result = String(text);
  for (const secret of secrets)
    result = result.replaceAll(secret, '[redacted]');
  // Any userinfo that survived, including one assembled at runtime. The user
  // part is optional because `redis://:password@host` has an empty username —
  // requiring one let a Redis password through.
  return result.replace(
    /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/@:]*)(:[^\s/@]*)?@/giu,
    '$1[redacted]@',
  );
}

export function servicePort(service, environment) {
  const raw = environment[service.portVariable];
  const port = Number(raw);
  return Number.isSafeInteger(port) && port > 0 && port < 65_536
    ? port
    : service.defaultPort;
}

/**
 * The ordered plan `demo:start` executes.
 *
 * Returned as data so the ordering, skipping and prerequisites can be asserted
 * without a Docker engine, a database or a free port.
 */
export function buildStartupPlan(environment, repositoryRoot = '.') {
  const steps = [
    { kind: 'env', description: 'Validate local environment configuration' },
    { kind: 'docker', description: 'Confirm the Docker engine is available' },
    { kind: 'infra', description: 'Start PostgreSQL and Redis' },
    { kind: 'infra-check', description: 'Check infrastructure health' },
    { kind: 'migrate', description: 'Apply committed migrations' },
  ];
  for (const service of DEMO_SERVICES) {
    if (service.optionalWhen?.(environment)) {
      steps.push({
        kind: 'skip',
        name: service.name,
        description: `Skip ${service.name} (not configured)`,
      });
      continue;
    }
    const port = servicePort(service, environment);
    steps.push({
      kind: 'service',
      name: service.name,
      port,
      entry: resolve(repositoryRoot, ...service.entry),
      cwd: resolve(repositoryRoot, ...service.cwd),
      arguments: service.argumentsFor?.(port) ?? [],
      readiness: `http://127.0.0.1:${String(port)}${service.live}`,
    });
  }
  return steps;
}

/** The service table. Names, ports and states only. */
export function formatServiceTable(rows) {
  const nameWidth = Math.max(7, ...rows.map((row) => row.name.length));
  const lines = [
    `  ${'SERVICE'.padEnd(nameWidth)}  PORT   STATE`,
    `  ${'-'.repeat(nameWidth)}  -----  -----`,
  ];
  for (const row of rows) {
    lines.push(
      `  ${row.name.padEnd(nameWidth)}  ${String(row.port).padEnd(5)}  ${row.state}`,
    );
  }
  return lines.join('\n');
}

/**
 * Classifies one probe.
 *
 * A response body never reaches the result. An upstream that returned a stack
 * trace or a connection string would otherwise print it straight into the demo
 * transcript.
 */
export function classifyProbe({ ok, status, error }) {
  if (error) return { state: 'unreachable', detail: error };
  if (ok) return { state: 'ready', detail: `HTTP ${String(status)}` };
  if (status === 503) return { state: 'degraded', detail: 'HTTP 503' };
  return { state: 'failed', detail: `HTTP ${String(status)}` };
}

/**
 * Shapes each health document must have.
 *
 * Liveness and readiness are different documents: liveness says the process is
 * running, readiness says it can do its job. Holding them to one shape was a
 * real bug — it required a readiness field of a liveness response.
 *
 * Extra fields are tolerated; missing ones are not.
 */
export const LIVENESS_SHAPE = ['status'];

export const READINESS_SHAPES = {
  Gateway: ['status', 'dependencies'],
  Resilience: ['status', 'database', 'backupKeyConfigured'],
};

/** Keys that must never appear in a health response. */
export const FORBIDDEN_HEALTH_KEYS = [
  'databaseUrl',
  'redisUrl',
  'password',
  'token',
  'internalToken',
  'encryptionKey',
  'backupKey',
  'stack',
];

export function verifyHealthDocument(name, payload, phase = 'live') {
  const problems = [];
  if (
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    return ['response is not a JSON object'];
  }
  const required =
    phase === 'ready'
      ? (READINESS_SHAPES[name] ?? LIVENESS_SHAPE)
      : LIVENESS_SHAPE;
  for (const field of required) {
    if (!(field in payload)) problems.push(`missing "${field}"`);
  }
  const serialised = JSON.stringify(payload);
  for (const forbidden of FORBIDDEN_HEALTH_KEYS) {
    if (Object.hasOwn(payload, forbidden)) {
      problems.push(`discloses "${forbidden}"`);
    }
  }
  // A connection string anywhere in the document, however it got there.
  if (/postgres(ql)?:\/\/|redis:\/\//u.test(serialised)) {
    problems.push('contains a connection string');
  }
  return problems;
}

/** One bounded probe. Drains and closes so no socket outlives the check. */
export async function probe(url, timeoutMs, fetchImplementation = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImplementation(url, {
      headers: { accept: 'application/json', connection: 'close' },
      signal: controller.signal,
    });
    const text = await response.text().catch(() => '');
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
    return { ok: response.ok, status: response.status, payload };
  } catch {
    // The cause is deliberately not propagated: a DNS or TLS error message can
    // name internal hosts.
    return { ok: false, status: 0, error: 'no response' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs the verification suite against a running stack.
 *
 * `fetchImplementation` is injectable so the whole decision table — which checks
 * run, what counts as a failure, what is reported — is testable without a
 * listening socket.
 */
export async function runVerification(environment, options = {}) {
  const fetchImplementation = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const secrets = collectSecrets(environment);
  const checks = [];

  for (const service of DEMO_SERVICES) {
    if (service.optionalWhen?.(environment)) {
      checks.push({
        name: service.name,
        port: '-',
        state: 'skipped',
        problems: [],
      });
      continue;
    }
    const port = servicePort(service, environment);
    const problems = [];

    const liveness = await probe(
      `http://127.0.0.1:${String(port)}${service.live}`,
      timeoutMs,
      fetchImplementation,
    );
    const classified = classifyProbe(liveness);
    if (classified.state !== 'ready') {
      problems.push(`liveness ${classified.detail}`);
    } else if (service.expectsJson !== false) {
      if (liveness.payload === undefined) {
        problems.push('liveness response is not JSON');
      } else {
        problems.push(...verifyHealthDocument(service.name, liveness.payload));
      }
    }

    if (service.ready && classified.state === 'ready') {
      const readiness = await probe(
        `http://127.0.0.1:${String(port)}${service.ready}`,
        timeoutMs,
        fetchImplementation,
      );
      // A readiness endpoint reporting 503 is doing its job; it is reported as
      // degraded rather than treated as a broken service.
      if (readiness.error) {
        problems.push('readiness no response');
      } else if (!readiness.ok) {
        // A readiness endpoint reporting 503 is doing its job. Its error body
        // is not the readiness document, so it is not held to that shape.
        problems.push('readiness degraded');
      } else if (readiness.payload === undefined) {
        problems.push('readiness response is not JSON');
      } else {
        problems.push(
          ...verifyHealthDocument(service.name, readiness.payload, 'ready').map(
            (item) => `readiness ${item}`,
          ),
        );
      }
    }

    checks.push({
      name: service.name,
      port,
      state: problems.length === 0 ? classified.state : 'failed',
      problems: problems.map((item) => redact(item, secrets)),
    });
  }

  const failures = checks.filter((check) => check.problems.length > 0);
  return { checks, ok: failures.length === 0, failures };
}

export function formatVerificationReport(result) {
  const lines = [
    formatServiceTable(
      result.checks.map((check) => ({
        name: check.name,
        port: check.port,
        state: check.state,
      })),
    ),
  ];
  for (const failure of result.failures) {
    for (const problem of failure.problems) {
      lines.push(`  ! ${failure.name}: ${problem}`);
    }
  }
  lines.push(
    result.ok
      ? '[demo] every service answered and every response matched its documented shape'
      : '[demo] verification failed',
  );
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Execution. Everything below touches the machine and is exercised in CI.     */
/* -------------------------------------------------------------------------- */

function runCommand(command, args, cwd, environment) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  return result.status ?? 1;
}

function pnpm(args, repositoryRoot, environment) {
  return runCommand('pnpm', args, repositoryRoot, environment);
}

const children = [];
let shuttingDown = false;

async function shutdown(code, log) {
  if (shuttingDown) return code;
  shuttingDown = true;
  log('\n[demo] stopping services');
  // Reverse order, and each child is waited for: a child that outlives the
  // parent keeps its port bound and makes the next start fail confusingly.
  for (const { name, child } of [...children].reverse()) {
    if (child.exitCode !== null) continue;
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((settle) => child.once('exit', settle)),
      new Promise((settle) => setTimeout(settle, 5_000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
    log(`[demo] ${name} stopped`);
  }
  log('[demo] local data was not touched');
  return code;
}

async function waitForReadiness(step, child, log) {
  for (let attempt = 0; attempt < 480; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`${step.name} exited during startup.`);
    }
    const result = await probe(step.readiness, 2_000);
    if (result.ok) return;
    await new Promise((settle) => setTimeout(settle, 125));
  }
  throw new Error(`${step.name} did not become ready in time.`);
}

async function runStart(repositoryRoot, environment, log) {
  const secrets = collectSecrets(environment);
  const plan = buildStartupPlan(environment, repositoryRoot);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      void shutdown(0, log).then((code) => process.exit(code));
    });
  }

  for (const step of plan) {
    if (step.kind === 'env') {
      log('[demo] validating environment configuration');
      if (pnpm(['env:check'], repositoryRoot, environment) !== 0) {
        log(
          '[demo] environment configuration is incomplete. Run: pnpm env:init:local',
        );
        return 1;
      }
      continue;
    }
    if (step.kind === 'docker') {
      log('[demo] checking the Docker engine');
      if (
        runCommand(
          'docker',
          ['info', '--format', '{{.ServerVersion}}'],
          repositoryRoot,
          environment,
        ) !== 0
      ) {
        log(
          '[demo] the Docker engine is not available. Start Docker and retry.',
        );
        return 1;
      }
      continue;
    }
    if (step.kind === 'infra') {
      if (pnpm(['infra:up'], repositoryRoot, environment) !== 0) return 1;
      continue;
    }
    if (step.kind === 'infra-check') {
      if (pnpm(['infra:check'], repositoryRoot, environment) !== 0) return 1;
      continue;
    }
    if (step.kind === 'migrate') {
      log('[demo] applying committed migrations');
      if (pnpm(['db:deploy'], repositoryRoot, environment) !== 0) return 1;
      continue;
    }
    if (step.kind === 'skip') {
      log(`[demo] ${step.description}`);
      continue;
    }

    if (!existsSync(step.entry)) {
      log(`[demo] ${step.name} build output is missing. Run: pnpm build`);
      return shutdown(1, log);
    }
    log(`[demo] starting ${step.name}`);
    const child = spawn(process.execPath, [step.entry, ...step.arguments], {
      cwd: step.cwd,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const write = (chunk) =>
      process.stdout.write(`[${step.name}] ${redact(String(chunk), secrets)}`);
    child.stdout.on('data', write);
    child.stderr.on('data', write);
    children.push({ name: step.name, child });
    try {
      await waitForReadiness(step, child, log);
    } catch (error) {
      log(
        `[demo] ${error instanceof Error ? error.message : 'startup failed'}`,
      );
      return shutdown(1, log);
    }
    log(`[demo] ${step.name} ready`);
  }

  log('');
  log(
    formatServiceTable(
      plan
        .filter((step) => step.kind === 'service')
        .map((step) => ({ name: step.name, port: step.port, state: 'ready' })),
    ),
  );
  log('');
  log('[demo] open http://localhost:3000');
  log('[demo] verify with: pnpm demo:verify');
  log('[demo] press Ctrl+C to stop; local data is preserved');
  // Held open by the children; the signal handlers own shutdown from here.
  await new Promise(() => {});
  return 0;
}

async function runStatus(environment, log) {
  const rows = [];
  for (const service of DEMO_SERVICES) {
    if (service.optionalWhen?.(environment)) {
      rows.push({ name: service.name, port: '-', state: 'skipped' });
      continue;
    }
    const port = servicePort(service, environment);
    const result = await probe(
      `http://127.0.0.1:${String(port)}${service.live}`,
      2_000,
    );
    rows.push({ name: service.name, port, state: classifyProbe(result).state });
  }
  log(formatServiceTable(rows));
  return rows.every((row) => ['ready', 'skipped'].includes(row.state)) ? 0 : 1;
}

async function runVerify(environment, log) {
  const result = await runVerification(environment);
  log(formatVerificationReport(result));
  return result.ok ? 0 : 1;
}

function runStop(repositoryRoot, environment, log) {
  log('[demo] stopping containers; named volumes and local data are preserved');
  return pnpm(['infra:down'], repositoryRoot, environment);
}

function runReset(repositoryRoot, environment, log) {
  log(
    '[demo] destroying local PostgreSQL and Redis volumes on explicit confirmation',
  );
  return pnpm(['infra:reset', '--', '--yes'], repositoryRoot, environment);
}

export async function main(
  argumentsList = process.argv.slice(2),
  log = console.log,
) {
  const repositoryRoot = resolveRepositoryRoot();
  let parsed;
  try {
    parsed = parseCliArguments(argumentsList);
  } catch (error) {
    log(`[demo] ${error instanceof DemoUsageError ? error.message : 'failed'}`);
    return 1;
  }
  const environment = loadEnvironment(repositoryRoot);
  switch (parsed.command) {
    case 'start':
      return runStart(repositoryRoot, environment, log);
    case 'status':
      return runStatus(environment, log);
    case 'verify':
      return runVerify(environment, log);
    case 'stop':
      return runStop(repositoryRoot, environment, log);
    default:
      return runReset(repositoryRoot, environment, log);
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (invokedPath === import.meta.url) {
  main().then((code) => {
    process.exitCode = code;
  });
}
