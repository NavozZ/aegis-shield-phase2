import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  EnvUsageError,
  GENERATED_VARIABLES,
  REQUIRED_VARIABLES,
  checkEnvironment,
  formatCheckReport,
  generateBackupKey,
  generateSecret,
  initializeEnvironmentText,
  parseCliArguments,
  parseEnvironmentText,
  validateBase64Key,
  validatePort,
  validatePostgresUrl,
  validateRedisUrl,
} from './env.mjs';

/*
 * Environment tooling tests.
 *
 * The property that matters most is negative: no value, ever, in any output.
 * A configuration checker that echoed the value it objected to would put a
 * password into a terminal scrollback, a CI log or a screenshot — which is
 * exactly what the configuration was protecting against.
 */

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const exampleText = readFileSync(
  resolve(repositoryRoot, '.env.example'),
  'utf8',
);

/** A complete, well-formed environment, built from the shipped example. */
function completeEnvironment(overrides = {}) {
  const { text } = initializeEnvironmentText(exampleText);
  const values = parseEnvironmentText(text);
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) values.delete(name);
    else values.set(name, value);
  }
  return values;
}

test('the shipped example initialises into a complete, valid environment', () => {
  const result = checkEnvironment(completeEnvironment());
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
});

test('every required variable is actually declared in .env.example', () => {
  // A required name that the example never declares would make a fresh
  // initialisation fail its own check.
  const declared = parseEnvironmentText(exampleText);
  const undeclared = Object.values(REQUIRED_VARIABLES)
    .flat()
    .filter((name) => !declared.has(name));
  assert.deepEqual(undeclared, []);
});

test('missing variables are listed by name and nothing else', () => {
  const values = completeEnvironment({
    RISK_INTERNAL_TOKEN: undefined,
    DR_BACKUP_ENCRYPTION_KEY: undefined,
  });
  const result = checkEnvironment(values);
  assert.ok(
    result.missing.some((item) => item.startsWith('RISK_INTERNAL_TOKEN')),
  );
  assert.ok(
    result.missing.some((item) => item.startsWith('DR_BACKUP_ENCRYPTION_KEY')),
  );
  assert.equal(result.ok, false);
});

test('no report ever contains a configured value', () => {
  const secret = 'Sw7xQ2vLm4Np7Ks9Td1Wc6Yb3Hg5Jf0A';
  const values = completeEnvironment({
    RISK_INTERNAL_TOKEN: secret,
    POSTGRES_PASSWORD: secret,
    // Deliberately broken so the report has something to say about them.
    DR_BACKUP_ENCRYPTION_KEY: secret,
    REDIS_URL: `redis://:${secret}@127.0.0.1:6379/0`,
    IDENTITY_DATABASE_URL: `postgresql://wrong_role:${secret}@127.0.0.1:5432/wrong_db?schema=app`,
  });
  const report = formatCheckReport(checkEnvironment(values));
  assert.ok(!report.includes(secret), 'the report leaked a configured value');
  assert.ok(report.includes('DR_BACKUP_ENCRYPTION_KEY'));
  assert.ok(report.includes('IDENTITY_DATABASE_URL'));
});

test('ports must be integers in range and must not collide', () => {
  assert.equal(validatePort('P', '4106'), null);
  assert.ok(validatePort('P', 'four thousand'));
  assert.ok(validatePort('P', '0'));
  assert.ok(validatePort('P', '70000'));
  assert.ok(validatePort('P', '41.06'));

  const collided = checkEnvironment(
    completeEnvironment({ RESILIENCE_SERVICE_PORT: '4105' }),
  );
  assert.ok(
    collided.problems.some(
      (item) =>
        item.variable === 'RESILIENCE_SERVICE_PORT' &&
        item.problem.includes('same port'),
    ),
  );
});

test('malformed database configuration is rejected', () => {
  assert.equal(
    validatePostgresUrl(
      'X',
      'postgresql://role:pass@127.0.0.1:5432/aegis_ledger?schema=app',
    ),
    null,
  );
  for (const bad of [
    'not a url',
    'mysql://role:pass@127.0.0.1:3306/db',
    'postgresql://127.0.0.1:5432/db',
    'postgresql://role@127.0.0.1:5432/db',
    'postgresql://role:pass@127.0.0.1:5432/bad-name;DROP',
  ]) {
    assert.ok(validatePostgresUrl('X', bad), `accepted ${bad}`);
  }
});

test('a database URL that names the wrong database or role is rejected', () => {
  const wrongDatabase = checkEnvironment(
    completeEnvironment({
      LEDGER_DATABASE_URL:
        'postgresql://aegis_ledger:pw@127.0.0.1:5432/aegis_payments?schema=app',
    }),
  );
  assert.ok(
    wrongDatabase.problems.some(
      (item) =>
        item.variable === 'LEDGER_DATABASE_URL' &&
        item.problem.includes('LEDGER_DB_NAME'),
    ),
  );

  const wrongRole = checkEnvironment(
    completeEnvironment({
      RESILIENCE_DATABASE_URL:
        'postgresql://aegis_admin:pw@127.0.0.1:5432/aegis_resilience?schema=app',
    }),
  );
  assert.ok(
    wrongRole.problems.some(
      (item) =>
        item.variable === 'RESILIENCE_DATABASE_URL' &&
        item.problem.includes('RESILIENCE_DB_USER'),
    ),
  );
});

test('malformed Redis configuration is rejected, including an unauthenticated URL', () => {
  assert.equal(validateRedisUrl('R', 'redis://:pw@127.0.0.1:6379/0'), null);
  for (const bad of [
    'not a url',
    'http://127.0.0.1:6379',
    'redis://127.0.0.1:6379/0',
  ]) {
    assert.ok(validateRedisUrl('R', bad), `accepted ${bad}`);
  }
});

test('the backup key must decode to exactly 32 non-zero bytes', () => {
  assert.equal(
    validateBase64Key('K', Buffer.alloc(32, 7).toString('base64'), 32),
    null,
  );
  for (const bad of [
    Buffer.alloc(16, 7).toString('base64'),
    Buffer.alloc(64, 7).toString('base64'),
    Buffer.alloc(32).toString('base64'),
    'not base64 !!',
    'BASE64_LOCAL_ONLY_32_BYTE_BACKUP_KEY_PLACEHOLDER',
  ]) {
    assert.ok(validateBase64Key('K', bad, 32), `accepted ${bad}`);
  }
});

test('SABCL placeholders are tolerated when off and refused when strict', () => {
  const off = checkEnvironment(completeEnvironment({ SABCL_MODE: 'off' }));
  assert.equal(off.ok, true);

  const strict = checkEnvironment(
    completeEnvironment({ SABCL_MODE: 'strict' }),
  );
  assert.ok(
    strict.problems.some(
      (item) =>
        item.variable === 'SABCL_ROUTE_SECRET' &&
        item.problem.includes('placeholder'),
    ),
  );

  const nonsense = checkEnvironment(
    completeEnvironment({ SABCL_MODE: 'sometimes' }),
  );
  assert.ok(nonsense.problems.some((item) => item.variable === 'SABCL_MODE'));
});

test('unsafe production demo settings are refused', () => {
  const production = checkEnvironment(
    completeEnvironment({
      NODE_ENV: 'production',
      DEMO_AUTH_ENABLED: 'true',
      RISK_OPERATOR_BOOTSTRAP_TOKEN: 'anything-at-all',
      SABCL_MODE: 'compatible',
      WEBAUTHN_ORIGIN: 'http://localhost:3000',
    }),
  );
  const named = production.problems.map((item) => item.variable);
  assert.ok(named.includes('DEMO_AUTH_ENABLED'));
  assert.ok(named.includes('RISK_OPERATOR_BOOTSTRAP_TOKEN'));
  assert.ok(named.includes('SABCL_MODE'));
  assert.ok(named.includes('WEBAUTHN_ORIGIN'));
  assert.equal(production.ok, false);
});

test('a shipped placeholder secret is refused in production but allowed locally', () => {
  const local = checkEnvironment(
    completeEnvironment({
      LEDGER_INTERNAL_TOKEN: 'local-only-ledger-token-change-me',
    }),
  );
  assert.equal(local.ok, true);

  const production = checkEnvironment(
    completeEnvironment({
      NODE_ENV: 'production',
      DEMO_AUTH_ENABLED: 'false',
      LEDGER_INTERNAL_TOKEN: 'local-only-ledger-token-change-me',
    }),
  );
  assert.ok(
    production.problems.some(
      (item) =>
        item.variable === 'LEDGER_INTERNAL_TOKEN' &&
        item.problem.includes('placeholder'),
    ),
  );
});

test('initialisation replaces every generated secret with fresh random material', () => {
  const first = initializeEnvironmentText(exampleText);
  const second = initializeEnvironmentText(exampleText);
  const a = parseEnvironmentText(first.text);
  const b = parseEnvironmentText(second.text);
  const shipped = parseEnvironmentText(exampleText);

  for (const name of Object.keys(GENERATED_VARIABLES)) {
    assert.notEqual(
      a.get(name),
      shipped.get(name),
      `${name} kept its placeholder`,
    );
    assert.notEqual(a.get(name), b.get(name), `${name} is not random`);
    assert.ok(a.get(name).length >= 32, `${name} is too short`);
  }
  assert.ok(first.generated.includes('DR_BACKUP_ENCRYPTION_KEY'));
});

test('connection URLs are rebuilt so no URL keeps an old password', () => {
  const { text } = initializeEnvironmentText(exampleText);
  const values = parseEnvironmentText(text);
  for (const [urlName, passwordName] of [
    ['DATABASE_URL', 'POSTGRES_PASSWORD'],
    ['IDENTITY_DATABASE_URL', 'IDENTITY_DB_PASSWORD'],
    ['LEDGER_DATABASE_URL', 'LEDGER_DB_PASSWORD'],
    ['PAYMENTS_DATABASE_URL', 'PAYMENTS_DB_PASSWORD'],
    ['RISK_DATABASE_URL', 'AUDIT_DB_PASSWORD'],
    ['RESILIENCE_DATABASE_URL', 'RESILIENCE_DB_PASSWORD'],
    ['REDIS_URL', 'REDIS_PASSWORD'],
  ]) {
    const url = new URL(values.get(urlName));
    assert.equal(
      decodeURIComponent(url.password),
      values.get(passwordName),
      `${urlName} does not carry the generated ${passwordName}`,
    );
  }
});

test('initialisation preserves comments, ordering and non-secret values', () => {
  const { text } = initializeEnvironmentText(exampleText);
  assert.ok(text.includes('# AEGIS Shield local development configuration'));
  assert.ok(text.includes('SABCL_MODE=off'));
  assert.ok(text.includes('LEDGER_DEFAULT_CURRENCY=LKR'));
  // SABCL private keys need X25519/Ed25519 material from pnpm sabcl:keys, so
  // they are deliberately left as placeholders with the mode off.
  assert.ok(text.includes('SABCL_GATEWAY_ENCRYPTION_PRIVATE_KEY=BASE64URL_'));

  const shippedNames = [...parseEnvironmentText(exampleText).keys()];
  const initialisedNames = [...parseEnvironmentText(text).keys()];
  assert.deepEqual(initialisedNames, shippedNames);
});

test('generated material is long and random', () => {
  const secrets = new Set(Array.from({ length: 50 }, () => generateSecret()));
  assert.equal(secrets.size, 50);
  assert.ok(generateSecret().length >= 32);
  assert.equal(Buffer.from(generateBackupKey(), 'base64').length, 32);
});

test('the CLI refuses an unknown command and requires --force to overwrite', () => {
  assert.throws(
    () => parseCliArguments(['destroy']),
    (error) =>
      error instanceof EnvUsageError &&
      /Use check or init/u.test(error.message),
  );
  assert.deepEqual(parseCliArguments(['check']), {
    command: 'check',
    force: false,
  });
  assert.deepEqual(parseCliArguments(['init']), {
    command: 'init',
    force: false,
  });
  assert.deepEqual(parseCliArguments(['init', '--force']), {
    command: 'init',
    force: true,
  });
  assert.throws(
    () => parseCliArguments(['init', '--overwrite']),
    /Use --force/u,
  );
});
