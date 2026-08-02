/**
 * Local environment tooling.
 *
 *   pnpm env:check        validate an existing .env without displaying any value
 *   pnpm env:init:local   create .env from .env.example with generated secrets
 *
 * Two rules govern everything in this file.
 *
 * First, a value is never printed. A misconfiguration report that echoed the
 * offending value would put a password or a key into a terminal scrollback, a CI
 * log or a screenshot — which is precisely the disclosure the configuration was
 * protecting against. Reports name the variable and describe the problem.
 *
 * Second, generated secrets are cryptographically random and are written only to
 * the ignored `.env`. Nothing here writes a secret to stdout, and `.env` is
 * git-ignored so a generated file cannot be committed.
 */
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export class EnvUsageError extends Error {}

export function resolveRepositoryRoot(moduleUrl = import.meta.url) {
  return resolve(dirname(fileURLToPath(moduleUrl)), '..', '..');
}

/** Anything matching this is a stand-in, never a usable secret. */
export const PLACEHOLDER_PATTERN =
  /change-me|local-only|placeholder|example-only|not-a-secret/iu;

const SERVICE_PORTS = [
  'WEB_PORT',
  'API_GATEWAY_PORT',
  'IDENTITY_SERVICE_PORT',
  'LEDGER_SERVICE_PORT',
  'SABCL_ROUTER_PORT',
  'PAYMENTS_SERVICE_PORT',
  'RISK_SERVICE_PORT',
  'RESILIENCE_SERVICE_PORT',
];

/**
 * Every variable that must be present for the full stack to start.
 *
 * Grouped so a report can say which capability is unconfigured rather than
 * printing one undifferentiated list.
 */
export const REQUIRED_VARIABLES = {
  core: ['NODE_ENV', ...SERVICE_PORTS, 'NEXT_PUBLIC_API_BASE_URL'],
  postgres: [
    'POSTGRES_HOST',
    'POSTGRES_PORT',
    'POSTGRES_ADMIN_DATABASE',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'DATABASE_URL',
    'IDENTITY_DB_NAME',
    'IDENTITY_DB_USER',
    'IDENTITY_DB_PASSWORD',
    'IDENTITY_DATABASE_URL',
    'LEDGER_DB_NAME',
    'LEDGER_DB_USER',
    'LEDGER_DB_PASSWORD',
    'LEDGER_DATABASE_URL',
    'PAYMENTS_DB_NAME',
    'PAYMENTS_DB_USER',
    'PAYMENTS_DB_PASSWORD',
    'PAYMENTS_DATABASE_URL',
    'AUDIT_DB_NAME',
    'AUDIT_DB_USER',
    'AUDIT_DB_PASSWORD',
    'RISK_DATABASE_URL',
    'RESILIENCE_DB_NAME',
    'RESILIENCE_DB_USER',
    'RESILIENCE_DB_PASSWORD',
    'RESILIENCE_DATABASE_URL',
  ],
  redis: ['REDIS_HOST', 'REDIS_PORT', 'REDIS_PASSWORD', 'REDIS_URL'],
  identity: [
    'IDENTITY_INTERNAL_TOKEN',
    'AUTH_SESSION_COOKIE_NAME',
    'AUTH_CSRF_COOKIE_NAME',
    'FIELD_ENCRYPTION_KEY',
  ],
  ledger: ['LEDGER_INTERNAL_TOKEN', 'LEDGER_DEFAULT_CURRENCY'],
  payments: [
    'PAYMENTS_INTERNAL_TOKEN',
    'PAYMENTS_MIN_TRANSFER_MINOR',
    'PAYMENTS_MAX_TRANSFER_MINOR',
    'PAYMENTS_QR_SIGNING_KEY',
    'USSD_PROVIDER_SECRET',
  ],
  risk: [
    'RISK_INTERNAL_TOKEN',
    'RISK_GATEWAY_SOURCE_TOKEN',
    'RISK_IDENTITY_SOURCE_TOKEN',
    'RISK_PAYMENTS_SOURCE_TOKEN',
    'RISK_LEDGER_SOURCE_TOKEN',
    'RISK_INFRASTRUCTURE_SOURCE_TOKEN',
    'RISK_CHANNEL_SOURCE_TOKEN',
  ],
  sabcl: ['SABCL_MODE', 'SABCL_ROUTER_URL'],
  resilience: [
    'RESILIENCE_INTERNAL_TOKEN',
    'RESILIENCE_GATEWAY_SOURCE_TOKEN',
    'RESILIENCE_TOOLING_SOURCE_TOKEN',
    'RESILIENCE_SERVICE_URL',
    'DR_BACKUP_ENCRYPTION_KEY',
  ],
};

/** Which service database each connection URL must actually name. */
const DATABASE_URL_BINDINGS = [
  {
    url: 'IDENTITY_DATABASE_URL',
    name: 'IDENTITY_DB_NAME',
    user: 'IDENTITY_DB_USER',
  },
  {
    url: 'LEDGER_DATABASE_URL',
    name: 'LEDGER_DB_NAME',
    user: 'LEDGER_DB_USER',
  },
  {
    url: 'PAYMENTS_DATABASE_URL',
    name: 'PAYMENTS_DB_NAME',
    user: 'PAYMENTS_DB_USER',
  },
  { url: 'RISK_DATABASE_URL', name: 'AUDIT_DB_NAME', user: 'AUDIT_DB_USER' },
  {
    url: 'RESILIENCE_DATABASE_URL',
    name: 'RESILIENCE_DB_NAME',
    user: 'RESILIENCE_DB_USER',
  },
];

export function parseEnvironmentText(text) {
  const values = new Map();
  for (const rawLine of String(text).split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    values.set(
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim(),
    );
  }
  return values;
}

function problem(variable, description) {
  return { variable, problem: description };
}

export function validatePort(name, value) {
  const port = Number(value);
  if (!/^\d+$/u.test(String(value)) || !Number.isSafeInteger(port)) {
    return problem(name, 'is not an integer port number');
  }
  if (port < 1 || port > 65_535) return problem(name, 'is outside 1-65535');
  return null;
}

export function validatePostgresUrl(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return problem(name, 'is not a valid URL');
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    return problem(name, 'must use the postgresql:// scheme');
  }
  if (!url.hostname) return problem(name, 'has no host');
  if (!url.username) return problem(name, 'has no login role');
  if (!url.password) return problem(name, 'has no password');
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ''));
  if (!/^[A-Za-z0-9_]{1,63}$/u.test(database)) {
    return problem(name, 'does not name a valid database');
  }
  return null;
}

export function validateRedisUrl(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return problem(name, 'is not a valid URL');
  }
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    return problem(name, 'must use the redis:// or rediss:// scheme');
  }
  if (!url.hostname) return problem(name, 'has no host');
  if (!url.password) {
    return problem(name, 'has no password; Redis must require authentication');
  }
  return null;
}

export function validateHttpUrl(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return problem(name, 'is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return problem(name, 'must use HTTP or HTTPS');
  }
  return null;
}

/** Decodes a base64 value and requires an exact byte length. */
export function validateBase64Key(name, value, expectedBytes) {
  const raw = String(value ?? '');
  if (!/^[A-Za-z0-9+/=_-]+$/u.test(raw)) {
    return problem(name, 'is not base64');
  }
  let decoded;
  try {
    decoded = Buffer.from(raw, 'base64');
  } catch {
    return problem(name, 'is not base64');
  }
  // Buffer.from is lenient, so the round trip is what actually proves the value
  // decodes cleanly rather than being silently truncated.
  if (decoded.length !== expectedBytes) {
    return problem(
      name,
      `must decode to exactly ${String(expectedBytes)} bytes`,
    );
  }
  if (decoded.every((byte) => byte === 0)) {
    return problem(name, 'is all zero bytes');
  }
  return null;
}

/**
 * Validates a complete environment.
 *
 * Returns variable names and problem descriptions. No value ever reaches the
 * result, so the caller cannot accidentally print one.
 */
export function checkEnvironment(values) {
  const missing = [];
  const problems = [];
  const get = (name) => values.get(name);
  const present = (name) => {
    const value = get(name);
    return typeof value === 'string' && value.length > 0;
  };

  for (const [group, names] of Object.entries(REQUIRED_VARIABLES)) {
    for (const name of names) {
      if (!present(name)) missing.push(`${name} (${group})`);
    }
  }

  const nodeEnvironment = (get('NODE_ENV') || 'development').trim();
  const production = nodeEnvironment === 'production';

  for (const name of [...SERVICE_PORTS, 'POSTGRES_PORT', 'REDIS_PORT']) {
    if (!present(name)) continue;
    const issue = validatePort(name, get(name));
    if (issue) problems.push(issue);
  }

  // Two services sharing a port is a startup failure that reads as a mysterious
  // "address in use" much later, so it is caught here.
  const seenPorts = new Map();
  for (const name of SERVICE_PORTS) {
    if (!present(name)) continue;
    const port = get(name);
    if (seenPorts.has(port)) {
      problems.push(
        problem(name, `uses the same port as ${seenPorts.get(port)}`),
      );
      continue;
    }
    seenPorts.set(port, name);
  }

  for (const name of [
    'DATABASE_URL',
    'IDENTITY_DATABASE_URL',
    'LEDGER_DATABASE_URL',
    'PAYMENTS_DATABASE_URL',
    'RISK_DATABASE_URL',
    'RESILIENCE_DATABASE_URL',
  ]) {
    if (!present(name)) continue;
    const issue = validatePostgresUrl(name, get(name));
    if (issue) problems.push(issue);
  }

  // A connection URL that names a different database than the one the
  // initialization script creates produces a role that cannot connect, hours
  // after the mistake was made.
  for (const binding of DATABASE_URL_BINDINGS) {
    if (!present(binding.url) || !present(binding.name)) continue;
    let url;
    try {
      url = new URL(get(binding.url));
    } catch {
      continue;
    }
    const database = decodeURIComponent(url.pathname.replace(/^\//u, ''));
    if (database !== get(binding.name)) {
      problems.push(
        problem(binding.url, `does not name the database in ${binding.name}`),
      );
    }
    if (
      present(binding.user) &&
      decodeURIComponent(url.username) !== get(binding.user)
    ) {
      problems.push(
        problem(binding.url, `does not use the login role in ${binding.user}`),
      );
    }
  }

  if (present('REDIS_URL')) {
    const issue = validateRedisUrl('REDIS_URL', get('REDIS_URL'));
    if (issue) problems.push(issue);
  }

  for (const name of [
    'NEXT_PUBLIC_API_BASE_URL',
    'IDENTITY_SERVICE_URL',
    'LEDGER_SERVICE_URL',
    'PAYMENTS_SERVICE_URL',
    'RISK_SERVICE_URL',
    'RESILIENCE_SERVICE_URL',
    'SABCL_ROUTER_URL',
  ]) {
    if (!present(name)) continue;
    const issue = validateHttpUrl(name, get(name));
    if (issue) problems.push(issue);
  }

  if (present('FIELD_ENCRYPTION_KEY')) {
    const issue = validateBase64Key(
      'FIELD_ENCRYPTION_KEY',
      get('FIELD_ENCRYPTION_KEY'),
      32,
    );
    if (issue) problems.push(issue);
  }

  // The backup key opens every encrypted set. An unusable one means the disaster
  // recovery tooling cannot run at all, so it is validated even outside
  // production.
  if (present('DR_BACKUP_ENCRYPTION_KEY')) {
    const issue = validateBase64Key(
      'DR_BACKUP_ENCRYPTION_KEY',
      get('DR_BACKUP_ENCRYPTION_KEY'),
      32,
    );
    if (issue) problems.push(issue);
  }

  const sabclMode = (get('SABCL_MODE') || 'off').trim();
  if (!['off', 'compatible', 'strict'].includes(sabclMode)) {
    problems.push(problem('SABCL_MODE', 'must be off, compatible or strict'));
  }
  if (sabclMode !== 'off') {
    // Strict and compatible both require real key material; a placeholder here
    // means the gateway will refuse to start rather than fall back quietly.
    const sabclSecrets = [
      'SABCL_ROUTE_SECRET',
      'SABCL_GATEWAY_ENCRYPTION_PRIVATE_KEY',
      'SABCL_GATEWAY_SIGNING_PRIVATE_KEY',
      'SABCL_IDENTITY_ENCRYPTION_PRIVATE_KEY',
      'SABCL_IDENTITY_SIGNING_PRIVATE_KEY',
      'SABCL_LEDGER_ENCRYPTION_PRIVATE_KEY',
      'SABCL_LEDGER_SIGNING_PRIVATE_KEY',
      'SABCL_PAYMENTS_ENCRYPTION_PRIVATE_KEY',
      'SABCL_PAYMENTS_SIGNING_PRIVATE_KEY',
      'SABCL_ROUTER_ENCRYPTION_PRIVATE_KEY',
      'SABCL_ROUTER_SIGNING_PRIVATE_KEY',
    ];
    for (const name of sabclSecrets) {
      if (!present(name)) {
        problems.push(
          problem(name, `is required when SABCL_MODE is ${sabclMode}`),
        );
        continue;
      }
      if (PLACEHOLDER_PATTERN.test(get(name))) {
        problems.push(
          problem(name, 'is still a placeholder; run pnpm sabcl:keys'),
        );
      }
    }
  }

  if (production) {
    // Development conveniences that must never reach production.
    if ((get('DEMO_AUTH_ENABLED') || '').trim().toLowerCase() === 'true') {
      problems.push(
        problem(
          'DEMO_AUTH_ENABLED',
          'must not be true when NODE_ENV=production',
        ),
      );
    }
    if (present('RISK_OPERATOR_BOOTSTRAP_TOKEN')) {
      problems.push(
        problem(
          'RISK_OPERATOR_BOOTSTRAP_TOKEN',
          'must not be set when NODE_ENV=production',
        ),
      );
    }
    if (sabclMode === 'compatible') {
      problems.push(
        problem(
          'SABCL_MODE',
          'compatible allows a plaintext fallback and is refused in production',
        ),
      );
    }
    if (!present('DR_BACKUP_ENCRYPTION_KEY')) {
      problems.push(
        problem(
          'DR_BACKUP_ENCRYPTION_KEY',
          'is required when NODE_ENV=production',
        ),
      );
    }
    for (const name of ['WEBAUTHN_RP_ID', 'WEBAUTHN_ORIGIN']) {
      if (present(name) && /localhost|127\.0\.0\.1/u.test(get(name))) {
        problems.push(problem(name, 'points at localhost in production'));
      }
    }
    // Any secret still carrying a shipped placeholder.
    for (const [name, value] of values) {
      if (!/PASSWORD|TOKEN|SECRET|KEY$/u.test(name)) continue;
      if (name.endsWith('_PATH') || name.endsWith('_ID')) continue;
      if (PLACEHOLDER_PATTERN.test(value)) {
        problems.push(problem(name, 'is still a shipped placeholder'));
      }
    }
  }

  return {
    nodeEnvironment,
    missing,
    problems,
    ok: missing.length === 0 && problems.length === 0,
  };
}

/** A URL-safe random secret. Long enough that a placeholder cannot be mistaken for one. */
export function generateSecret(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

export function generateBackupKey() {
  return randomBytes(32).toString('base64');
}

/** Variables `env:init:local` replaces, and how each is generated. */
export const GENERATED_VARIABLES = {
  POSTGRES_PASSWORD: 'secret',
  IDENTITY_DB_PASSWORD: 'secret',
  LEDGER_DB_PASSWORD: 'secret',
  PAYMENTS_DB_PASSWORD: 'secret',
  AUDIT_DB_PASSWORD: 'secret',
  RESILIENCE_DB_PASSWORD: 'secret',
  REDIS_PASSWORD: 'secret',
  IDENTITY_INTERNAL_TOKEN: 'secret',
  LEDGER_INTERNAL_TOKEN: 'secret',
  PAYMENTS_INTERNAL_TOKEN: 'secret',
  PAYMENTS_QR_SIGNING_KEY: 'secret',
  USSD_PROVIDER_SECRET: 'secret',
  SERVICE_AUTH_SHARED_SECRET: 'secret',
  RISK_INTERNAL_TOKEN: 'secret',
  RISK_GATEWAY_SOURCE_TOKEN: 'secret',
  RISK_IDENTITY_SOURCE_TOKEN: 'secret',
  RISK_PAYMENTS_SOURCE_TOKEN: 'secret',
  RISK_LEDGER_SOURCE_TOKEN: 'secret',
  RISK_INFRASTRUCTURE_SOURCE_TOKEN: 'secret',
  RISK_CHANNEL_SOURCE_TOKEN: 'secret',
  RESILIENCE_INTERNAL_TOKEN: 'secret',
  RESILIENCE_GATEWAY_SOURCE_TOKEN: 'secret',
  RESILIENCE_TOOLING_SOURCE_TOKEN: 'secret',
  FIELD_ENCRYPTION_KEY: 'key32',
  DR_BACKUP_ENCRYPTION_KEY: 'key32',
};

/** Connection URLs rebuilt from their components after regeneration. */
const REBUILT_URLS = [
  {
    url: 'DATABASE_URL',
    user: 'POSTGRES_USER',
    password: 'POSTGRES_PASSWORD',
    database: 'POSTGRES_ADMIN_DATABASE',
    schema: null,
  },
  {
    url: 'IDENTITY_DATABASE_URL',
    user: 'IDENTITY_DB_USER',
    password: 'IDENTITY_DB_PASSWORD',
    database: 'IDENTITY_DB_NAME',
    schema: 'app',
  },
  {
    url: 'LEDGER_DATABASE_URL',
    user: 'LEDGER_DB_USER',
    password: 'LEDGER_DB_PASSWORD',
    database: 'LEDGER_DB_NAME',
    schema: 'app',
  },
  {
    url: 'PAYMENTS_DATABASE_URL',
    user: 'PAYMENTS_DB_USER',
    password: 'PAYMENTS_DB_PASSWORD',
    database: 'PAYMENTS_DB_NAME',
    schema: 'app',
  },
  {
    url: 'AUDIT_DATABASE_URL',
    user: 'AUDIT_DB_USER',
    password: 'AUDIT_DB_PASSWORD',
    database: 'AUDIT_DB_NAME',
    schema: null,
  },
  {
    url: 'RISK_DATABASE_URL',
    user: 'AUDIT_DB_USER',
    password: 'AUDIT_DB_PASSWORD',
    database: 'AUDIT_DB_NAME',
    schema: 'app',
  },
  {
    url: 'RESILIENCE_DATABASE_URL',
    user: 'RESILIENCE_DB_USER',
    password: 'RESILIENCE_DB_PASSWORD',
    database: 'RESILIENCE_DB_NAME',
    schema: 'app',
  },
];

/**
 * Produces a local `.env` from `.env.example`.
 *
 * Every secret is replaced with fresh random material and every connection URL
 * is rebuilt from its components, so a regenerated password cannot leave a URL
 * pointing at the old one. Comments, ordering and non-secret values are
 * preserved, which keeps the generated file diffable against the example.
 *
 * SABCL private keys are deliberately NOT generated here: they are X25519 and
 * Ed25519 material produced by `pnpm sabcl:keys`, and `SABCL_MODE` ships as
 * `off` so a freshly initialised file starts a working stack.
 */
export function initializeEnvironmentText(exampleText, options = {}) {
  const secret = options.generateSecret ?? generateSecret;
  const key32 = options.generateBackupKey ?? generateBackupKey;

  const values = parseEnvironmentText(exampleText);
  const replacements = new Map();
  for (const [name, kind] of Object.entries(GENERATED_VARIABLES)) {
    if (!values.has(name)) continue;
    replacements.set(name, kind === 'key32' ? key32() : secret());
  }

  const resolved = (name) => replacements.get(name) ?? values.get(name) ?? '';
  for (const binding of REBUILT_URLS) {
    if (!values.has(binding.url)) continue;
    const host = values.get('POSTGRES_HOST') || '127.0.0.1';
    const port = values.get('POSTGRES_PORT') || '5432';
    const query = binding.schema ? `?schema=${binding.schema}` : '';
    replacements.set(
      binding.url,
      `postgresql://${encodeURIComponent(resolved(binding.user))}:${encodeURIComponent(
        resolved(binding.password),
      )}@${host}:${port}/${resolved(binding.database)}${query}`,
    );
  }
  if (values.has('REDIS_URL')) {
    const host = values.get('REDIS_HOST') || '127.0.0.1';
    const port = values.get('REDIS_PORT') || '6379';
    replacements.set(
      'REDIS_URL',
      `redis://:${encodeURIComponent(resolved('REDIS_PASSWORD'))}@${host}:${port}/0`,
    );
  }

  const rendered = String(exampleText)
    .split(/\r?\n/u)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const separator = line.indexOf('=');
      if (separator <= 0) return line;
      const name = line.slice(0, separator).trim();
      if (!replacements.has(name)) return line;
      return `${name}=${replacements.get(name)}`;
    })
    .join('\n');

  return { text: rendered, generated: [...replacements.keys()].sort() };
}

export function parseCliArguments(argumentsList) {
  const [command, ...rest] = argumentsList;
  if (!['check', 'init'].includes(command)) {
    throw new EnvUsageError(
      'Unsupported environment command. Use check or init.',
    );
  }
  let force = false;
  for (const argument of rest) {
    if (argument === '--force' || argument === '--yes') {
      force = true;
      continue;
    }
    throw new EnvUsageError('Unsupported argument. Use --force to overwrite.');
  }
  return { command, force };
}

/** Formats a report. Variable names and descriptions only, never a value. */
export function formatCheckReport(result) {
  const lines = [];
  lines.push(`[env] NODE_ENV=${result.nodeEnvironment}`);
  if (result.missing.length > 0) {
    lines.push(`[env] ${String(result.missing.length)} missing variables:`);
    for (const name of result.missing) lines.push(`  missing  ${name}`);
  }
  if (result.problems.length > 0) {
    lines.push(
      `[env] ${String(result.problems.length)} configuration problems:`,
    );
    for (const item of result.problems) {
      lines.push(`  invalid  ${item.variable} — ${item.problem}`);
    }
  }
  lines.push(
    result.ok
      ? '[env] configuration is complete and well formed'
      : '[env] configuration is incomplete; no values were displayed',
  );
  return lines.join('\n');
}

function runCheck(repositoryRoot, log) {
  const envPath = resolve(repositoryRoot, '.env');
  if (!existsSync(envPath)) {
    log('[env] .env is missing. Create one with: pnpm env:init:local');
    return 1;
  }
  const result = checkEnvironment(
    parseEnvironmentText(readFileSync(envPath, 'utf8')),
  );
  log(formatCheckReport(result));
  return result.ok ? 0 : 1;
}

function runInit(repositoryRoot, force, log) {
  const envPath = resolve(repositoryRoot, '.env');
  const examplePath = resolve(repositoryRoot, '.env.example');
  if (!existsSync(examplePath)) {
    log('[env] .env.example is missing.');
    return 1;
  }
  if (existsSync(envPath) && !force) {
    // Overwriting silently would destroy working local credentials, and the
    // person running it would not find out until the stack failed to start.
    log(
      '[env] .env already exists. Refusing to overwrite.\n' +
        '[env] Re-run with an explicit confirmation to replace it:\n' +
        '[env]   pnpm env:init:local -- --force',
    );
    return 1;
  }
  if (existsSync(envPath)) {
    const backup = `${envPath}.replaced`;
    copyFileSync(envPath, backup);
    log('[env] previous .env copied to .env.replaced (also git-ignored)');
  }
  const { text, generated } = initializeEnvironmentText(
    readFileSync(examplePath, 'utf8'),
  );
  writeFileSync(envPath, text, { encoding: 'utf8' });
  log(
    [
      `[env] wrote .env with ${String(generated.length)} generated values`,
      '[env] generated: ' + generated.join(', '),
      '[env] no value was printed; .env is git-ignored and must never be committed',
      '[env] SABCL keys are not generated here. SABCL_MODE stays off until you run:',
      '[env]   pnpm sabcl:keys -- --service gateway --version 1',
      '[env] verify with: pnpm env:check',
    ].join('\n'),
  );
  return 0;
}

export function main(argumentsList = process.argv.slice(2), log = console.log) {
  const repositoryRoot = resolveRepositoryRoot();
  try {
    const { command, force } = parseCliArguments(argumentsList);
    return command === 'check'
      ? runCheck(repositoryRoot, log)
      : runInit(repositoryRoot, force, log);
  } catch (error) {
    if (error instanceof EnvUsageError) {
      log(`[env] ${error.message}`);
      return 1;
    }
    // Never render an unexpected error message: it may quote a line of .env.
    log('[env] Environment command failed unexpectedly.');
    return 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (invokedPath === import.meta.url) {
  process.exitCode = main();
}
