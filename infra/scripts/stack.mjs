#!/usr/bin/env node

/**
 * Starts the full AEGIS stack from built output and waits for each service to
 * report readiness before starting the next one.
 *
 * Cross-platform: it spawns Node directly rather than relying on a shell, waits
 * on HTTP readiness endpoints instead of fixed delays, and terminates every
 * child cleanly on Ctrl+C so no process is left listening.
 *
 * This requires PostgreSQL and Redis, so it cannot run on a machine without
 * Docker. Use `pnpm dev` for the watch-mode developer loop instead.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

function parseEnvironmentFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/u)
      .filter(
        (line) =>
          line && !line.trimStart().startsWith('#') && line.includes('='),
      )
      .map((line) => {
        const separator = line.indexOf('=');
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim(),
        ];
      }),
  );
}

const environment = {
  ...parseEnvironmentFile(resolve(repositoryRoot, '.env.example')),
  ...parseEnvironmentFile(resolve(repositoryRoot, '.env')),
  ...process.env,
};

const SECRET_NAMES = [
  'POSTGRES_PASSWORD',
  'IDENTITY_DB_PASSWORD',
  'LEDGER_DB_PASSWORD',
  'PAYMENTS_DB_PASSWORD',
  'AUDIT_DB_PASSWORD',
  'REDIS_PASSWORD',
  'IDENTITY_INTERNAL_TOKEN',
  'LEDGER_INTERNAL_TOKEN',
  'PAYMENTS_INTERNAL_TOKEN',
  'FIELD_ENCRYPTION_KEY',
  'SERVICE_AUTH_SHARED_SECRET',
  'SABCL_KEY_MATERIAL',
  'IDENTITY_DATABASE_URL',
  'LEDGER_DATABASE_URL',
  'PAYMENTS_DATABASE_URL',
  'REDIS_URL',
  'DATABASE_URL',
];

/** Never let a secret reach the terminal through a child process log line. */
function redact(text) {
  let result = text;
  for (const name of SECRET_NAMES) {
    const value = environment[name];
    if (value && value.length > 3)
      result = result.replaceAll(value, '[redacted]');
  }
  return result;
}

const services = [
  {
    name: 'Identity',
    entry: resolve(repositoryRoot, 'services', 'identity', 'dist', 'main.js'),
    cwd: resolve(repositoryRoot, 'services', 'identity'),
    readiness: `http://127.0.0.1:${environment.IDENTITY_SERVICE_PORT || environment.IDENTITY_PORT || 4101}/health/live`,
  },
  {
    name: 'Ledger',
    entry: resolve(repositoryRoot, 'services', 'ledger', 'dist', 'main.js'),
    cwd: resolve(repositoryRoot, 'services', 'ledger'),
    readiness: `http://127.0.0.1:${environment.LEDGER_SERVICE_PORT || 4102}/health`,
  },
  {
    name: 'Payments',
    entry: resolve(repositoryRoot, 'services', 'payments', 'dist', 'main.js'),
    cwd: resolve(repositoryRoot, 'services', 'payments'),
    readiness: `http://127.0.0.1:${environment.PAYMENTS_SERVICE_PORT || 4104}/health/live`,
  },
  {
    name: 'Gateway',
    entry: resolve(repositoryRoot, 'apps', 'api-gateway', 'dist', 'main.js'),
    cwd: resolve(repositoryRoot, 'apps', 'api-gateway'),
    readiness: `http://127.0.0.1:${environment.API_GATEWAY_PORT || environment.API_PORT || 4000}/health`,
  },
  {
    name: 'Web',
    entry: resolve(
      repositoryRoot,
      'apps',
      'web',
      'node_modules',
      'next',
      'dist',
      'bin',
      'next',
    ),
    cwd: resolve(repositoryRoot, 'apps', 'web'),
    args: ['start', '--port', String(environment.WEB_PORT || 3000)],
    readiness: `http://127.0.0.1:${environment.WEB_PORT || 3000}`,
  },
];

const children = [];
let shuttingDown = false;

function start(service) {
  const child = spawn(
    process.execPath,
    [service.entry, ...(service.args ?? [])],
    {
      cwd: service.cwd,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const write = (chunk) =>
    process.stdout.write(`[${service.name}] ${redact(String(chunk))}`);
  child.stdout.on('data', write);
  child.stderr.on('data', write);
  children.push({ name: service.name, child });
  return child;
}

async function waitForReadiness(service, child) {
  // Poll the readiness endpoint rather than sleeping for a fixed interval.
  for (let attempt = 0; attempt < 480; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`${service.name} exited during startup.`);
    }
    try {
      if ((await fetch(service.readiness)).ok) return;
    } catch {
      // The listener is still binding.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 125));
  }
  throw new Error(`${service.name} did not become ready in time.`);
}

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write('\n[stack] stopping services\n');
  for (const { child } of [...children].reverse()) {
    if (child.exitCode !== null) continue;
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  process.stdout.write('[stack] all services stopped\n');
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void shutdown(0);
  });
}

try {
  for (const service of services) {
    if (!existsSync(service.entry)) {
      throw new Error(
        `${service.name} build output is missing. Run "pnpm build" first.`,
      );
    }
    process.stdout.write(`[stack] starting ${service.name}\n`);
    const child = start(service);
    await waitForReadiness(service, child);
    process.stdout.write(`[stack] ${service.name} ready\n`);
  }
  process.stdout.write(
    '[stack] Web 3000, Gateway 4000, Identity 4101, Ledger 4102, Payments 4104 — press Ctrl+C to stop\n',
  );
} catch (error) {
  process.stderr.write(
    `[stack] ${error instanceof Error ? error.message : 'Startup failed.'}\n`,
  );
  await shutdown(1);
}
