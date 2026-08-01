import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createClient } from 'redis';

const mode = process.argv[2];
if (!['functional', 'a11y'].includes(mode))
  throw new Error('Expected functional or a11y mode.');
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(webRoot, '..', '..');
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli)
  throw new Error('pnpm CLI path is unavailable. Run through pnpm.');
const testPhones = [
  '+12025550123',
  '+12025550124',
  '+12025550125',
  '+12025550126',
  '+12025550127',
];
const children = [];

function parseEnvironment(path) {
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
  ...parseEnvironment(resolve(repositoryRoot, '.env.example')),
  ...parseEnvironment(resolve(repositoryRoot, '.env')),
  ...process.env,
  NODE_ENV: 'test',
  CI: process.env.CI || '',
  DEMO_AUTH_ENABLED: 'true',
  IDENTITY_REDIS_PREFIX: `aegis:identity:test:web:${process.pid}:`,
  WEBAUTHN_RP_ID: 'localhost',
  WEBAUTHN_ORIGIN: 'http://localhost:3000',
  NEXT_PUBLIC_API_BASE_URL: 'http://localhost:4000',
};

function redact(text) {
  let result = text;
  for (const name of [
    'POSTGRES_PASSWORD',
    'IDENTITY_DB_PASSWORD',
    'LEDGER_DB_PASSWORD',
    'REDIS_PASSWORD',
    'IDENTITY_INTERNAL_TOKEN',
    'LEDGER_INTERNAL_TOKEN',
    'FIELD_ENCRYPTION_KEY',
  ]) {
    const value = environment[name];
    if (value) result = result.replaceAll(value, '[redacted]');
  }
  return result;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const output = [];
    const child = spawn(command, args, {
      cwd: options.cwd || repositoryRoot,
      env: options.env || environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => output.push(String(chunk)));
    child.stderr.on('data', (chunk) => output.push(String(chunk)));
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolveRun();
      else {
        const lines = redact(output.join('')).split(/\r?\n/u);
        const diagnostics = lines.filter((line) =>
          line.includes('[web-e2e-diagnostic]'),
        );
        reject(
          new Error(
            `${command} ${args.join(' ')} failed (${code}).\n${[...diagnostics, ...lines.slice(-35)].join('\n')}`,
          ),
        );
      }
    });
  });
}

function runPnpm(args, options) {
  return run(process.execPath, [pnpmCli, ...args], options);
}

function start(name, entry, cwd, args = []) {
  const recent = [];
  const child = spawn(process.execPath, [entry, ...args], {
    cwd,
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (chunk) => {
    recent.push(redact(String(chunk)));
    if (recent.length > 30) recent.shift();
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.once('exit', (code) => {
    if (code && code !== 0)
      process.stderr.write(
        `[web-e2e] ${name} exited (${code})\n${recent.join('').split(/\r?\n/u).slice(-20).join('\n')}\n`,
      );
  });
  children.push({ name, child });
  return child;
}

async function waitFor(url, child, label) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (child.exitCode !== null)
      throw new Error(`${label} exited during startup.`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* Binding is still in progress. */
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 125));
  }
  throw new Error(`${label} did not become ready within thirty seconds.`);
}

async function portIsOpen(port) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(250);
    socket.once('connect', () => {
      socket.destroy();
      resolvePort(true);
    });
    const closed = () => {
      socket.destroy();
      resolvePort(false);
    };
    socket.once('error', closed);
    socket.once('timeout', closed);
  });
}

async function stopChildren() {
  for (const { child } of children.reverse()) {
    if (child.exitCode !== null) continue;
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      new Promise((resolveWait) => setTimeout(resolveWait, 3_000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

/**
 * Removes the ledger records belonging to the synthetic browser-test customers.
 *
 * Posted journals and postings are append-only by design and are never deleted;
 * the browser journey creates accounts only, so their ledger accounts and
 * balance projections can be removed safely.
 */
async function cleanLedgerTestData(customerIds) {
  if (customerIds.length === 0) return;
  const pool = new pg.Pool({
    connectionString: environment.LEDGER_DATABASE_URL,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT ledger_account_id FROM app.customer_accounts WHERE customer_id = ANY($1::uuid[])',
      [customerIds],
    );
    await client.query(
      'DELETE FROM app.customer_accounts WHERE customer_id = ANY($1::uuid[])',
      [customerIds],
    );
    if (rows.length > 0) {
      await client.query(
        `DELETE FROM app.ledger_accounts
         WHERE id = ANY($1::uuid[])
           AND NOT EXISTS (
             SELECT 1 FROM app.journal_postings
             WHERE journal_postings.ledger_account_id = ledger_accounts.id
           )`,
        [rows.map((row) => row.ledger_account_id)],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function cleanTestData() {
  if (environment.NODE_ENV !== 'test')
    throw new Error('Scoped cleanup requires NODE_ENV=test.');
  const maskedActors = testPhones.map(
    (phone) =>
      `${phone.slice(0, 3)}${'*'.repeat(phone.length - 6)}${phone.slice(-3)}`,
  );
  const pool = new pg.Pool({
    connectionString: environment.IDENTITY_DATABASE_URL,
  });
  const client = await pool.connect();
  let testCustomerIds = [];
  try {
    const { rows } = await client.query(
      'SELECT id FROM app.users WHERE phone_e164 = ANY($1::text[])',
      [testPhones],
    );
    testCustomerIds = rows.map((row) => row.id);
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM app.auth_events WHERE masked_actor = ANY($1::text[]) OR user_id IN (SELECT id FROM app.users WHERE phone_e164 = ANY($2::text[]))',
      [maskedActors, testPhones],
    );
    await client.query(
      'DELETE FROM app.users WHERE phone_e164 = ANY($1::text[])',
      [testPhones],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
  await cleanLedgerTestData(testCustomerIds);
  const redis = createClient({ url: environment.REDIS_URL });
  await redis.connect();
  for await (const keys of redis.scanIterator({
    MATCH: `${environment.IDENTITY_REDIS_PREFIX}*`,
    COUNT: 100,
  }))
    if (keys.length) await redis.unlink(keys);
  await redis.quit();
}

let failure;
function captureFailure(error) {
  failure = failure
    ? new AggregateError([failure, error], 'Browser test and cleanup failed.')
    : error;
}
try {
  for (const port of [3000, 4000, 4101, 4102, 4104])
    if (await portIsOpen(port))
      throw new Error(`Required test port ${port} is already in use.`);
  process.stderr.write(`[web-e2e] preparing ${mode} stack\n`);
  await runPnpm(['infra:up']);
  await runPnpm(['infra:check']);
  await runPnpm(['db:deploy:identity']);
  await runPnpm(['db:deploy:ledger']);
  await runPnpm(['db:deploy:payments']);
  await cleanTestData();
  await runPnpm(['--filter', '@aegis/contracts', 'build']);
  await runPnpm(['--filter', '@aegis/identity-service', 'build']);
  await runPnpm(['--filter', '@aegis/ledger-service', 'build']);
  await runPnpm(['--filter', '@aegis/payments-service', 'build']);
  await runPnpm(['--filter', '@aegis/api-gateway', 'build']);
  await runPnpm(['--filter', '@aegis/web', 'build'], {
    env: { ...environment, NODE_ENV: 'production' },
  });
  const identity = start(
    'Identity',
    resolve(repositoryRoot, 'services', 'identity', 'dist', 'main.js'),
    resolve(repositoryRoot, 'services', 'identity'),
  );
  await waitFor('http://127.0.0.1:4101/health/live', identity, 'Identity');
  const ledger = start(
    'Ledger',
    resolve(repositoryRoot, 'services', 'ledger', 'dist', 'main.js'),
    resolve(repositoryRoot, 'services', 'ledger'),
  );
  await waitFor('http://127.0.0.1:4102/health', ledger, 'Ledger');
  const payments = start(
    'Payments',
    resolve(repositoryRoot, 'services', 'payments', 'dist', 'main.js'),
    resolve(repositoryRoot, 'services', 'payments'),
  );
  await waitFor('http://127.0.0.1:4104/health', payments, 'Payments');
  const gateway = start(
    'Gateway',
    resolve(repositoryRoot, 'apps', 'api-gateway', 'dist', 'main.js'),
    resolve(repositoryRoot, 'apps', 'api-gateway'),
  );
  await waitFor('http://127.0.0.1:4000/health', gateway, 'Gateway');
  const nextServer = start(
    'Next.js',
    resolve(webRoot, 'node_modules', 'next', 'dist', 'bin', 'next'),
    webRoot,
    ['start', '--port', '3000'],
  );
  await waitFor('http://127.0.0.1:3000', nextServer, 'Next.js');
  process.stderr.write(`[web-e2e] running ${mode} browser tests\n`);
  await run(
    process.execPath,
    [
      resolve(webRoot, 'node_modules', '@playwright', 'test', 'cli.js'),
      'test',
      '--grep',
      mode === 'functional' ? '@functional' : '@a11y',
    ],
    { cwd: webRoot },
  );
} catch (error) {
  failure = error;
} finally {
  await stopChildren().catch((error) => {
    captureFailure(error);
  });
  await cleanTestData().catch((error) => {
    captureFailure(error);
  });
  await runPnpm(['infra:down']).catch((error) => {
    captureFailure(error);
  });
  for (const port of [3000, 4000, 4101, 4102, 4104])
    if (await portIsOpen(port))
      captureFailure(
        new Error(`Port ${port} remained in use after browser cleanup.`),
      );
}
if (failure) throw failure;
process.stderr.write(`[web-e2e] ${mode} stack stopped cleanly\n`);
