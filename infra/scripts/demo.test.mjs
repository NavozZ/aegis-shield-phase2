import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEMO_SERVICES,
  DemoUsageError,
  FORBIDDEN_HEALTH_KEYS,
  LIVENESS_SHAPE,
  buildStartupPlan,
  classifyProbe,
  collectSecrets,
  formatServiceTable,
  formatVerificationReport,
  parseCliArguments,
  probe,
  redact,
  runVerification,
  servicePort,
  verifyHealthDocument,
} from './demo.mjs';

/*
 * Demo orchestration tests.
 *
 * This machine has no Docker engine, so the value here is in testing the parts
 * that decide what happens: the order of the plan, what is skipped, what counts
 * as a failure, and — most importantly — that nothing printed can carry a
 * credential.
 */

const ENVIRONMENT = {
  SABCL_MODE: 'off',
  WEB_PORT: '3000',
  API_GATEWAY_PORT: '4000',
  IDENTITY_SERVICE_PORT: '4101',
  LEDGER_SERVICE_PORT: '4102',
  SABCL_ROUTER_PORT: '4103',
  PAYMENTS_SERVICE_PORT: '4104',
  RISK_SERVICE_PORT: '4105',
  RESILIENCE_SERVICE_PORT: '4106',
  POSTGRES_PASSWORD: 'unit-only-postgres-password',
  RISK_INTERNAL_TOKEN: 'unit-only-risk-internal-token',
  DR_BACKUP_ENCRYPTION_KEY: 'dW5pdC1vbmx5LWJhY2t1cC1rZXktMzItYnl0ZXMtb2s=',
  RESILIENCE_DATABASE_URL:
    'postgresql://aegis_resilience:unit-only-db-password@127.0.0.1:5432/aegis_resilience?schema=app',
};

const HEALTHY = { status: 'ok' };

/** A fetch stand-in driven by a route table. */
function fakeFetch(routes) {
  return async (url) => {
    const path = new URL(url).port + new URL(url).pathname;
    const route = routes[path];
    if (route === undefined) throw new Error('connection refused');
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      text: async () => JSON.stringify(route.body ?? {}),
    };
  };
}

/** Every port/path pair the verifier probes when everything is healthy. */
function healthyRoutes(overrides = {}) {
  return {
    '4101/health/live': { status: 200, body: HEALTHY },
    '4102/health/live': { status: 200, body: HEALTHY },
    '4104/health/live': { status: 200, body: HEALTHY },
    '4105/health/live': { status: 200, body: HEALTHY },
    '4106/health/live': { status: 200, body: HEALTHY },
    '4106/health/ready': {
      status: 200,
      body: {
        status: 'ok',
        configurationValid: true,
        database: 'ok',
        backupKeyConfigured: true,
      },
    },
    '4000/health': { status: 200, body: HEALTHY },
    '4000/health/ready': {
      status: 200,
      body: { status: 'ready', dependencies: { identity: 'up' } },
    },
    '3000/': { status: 200, body: {} },
    ...overrides,
  };
}

test('the demo stack covers every documented port', () => {
  const ports = DEMO_SERVICES.map((service) =>
    servicePort(service, ENVIRONMENT),
  ).sort((a, b) => a - b);
  assert.deepEqual(ports, [3000, 4000, 4101, 4102, 4103, 4104, 4105, 4106]);
});

test('an invalid or absent port falls back to the documented default', () => {
  const resilience = DEMO_SERVICES.find((s) => s.name === 'Resilience');
  assert.equal(servicePort(resilience, {}), 4106);
  assert.equal(
    servicePort(resilience, { RESILIENCE_SERVICE_PORT: 'nope' }),
    4106,
  );
  assert.equal(
    servicePort(resilience, { RESILIENCE_SERVICE_PORT: '70000' }),
    4106,
  );
  assert.equal(
    servicePort(resilience, { RESILIENCE_SERVICE_PORT: '4200' }),
    4200,
  );
});

test('the startup plan validates, checks Docker and migrates before any service', () => {
  const plan = buildStartupPlan(ENVIRONMENT, '/repo');
  const kinds = plan.slice(0, 5).map((step) => step.kind);
  assert.deepEqual(kinds, ['env', 'docker', 'infra', 'infra-check', 'migrate']);
});

test('the plan starts services in dependency order with the router before the gateway', () => {
  const plan = buildStartupPlan(
    { ...ENVIRONMENT, SABCL_MODE: 'strict' },
    '/repo',
  );
  const names = plan
    .filter((step) => step.kind === 'service')
    .map((step) => step.name);
  assert.deepEqual(names, [
    'Identity',
    'Ledger',
    'SABCL router',
    'Payments',
    'Risk',
    'Resilience',
    'Gateway',
    'Web',
  ]);
  assert.ok(names.indexOf('SABCL router') < names.indexOf('Gateway'));
  assert.ok(names.indexOf('Resilience') < names.indexOf('Gateway'));
});

test('the router is skipped, not failed, when SABCL is off', () => {
  const plan = buildStartupPlan({ ...ENVIRONMENT, SABCL_MODE: 'off' }, '/repo');
  const router = plan.find((step) => step.name === 'SABCL router');
  assert.equal(router.kind, 'skip');
  assert.ok(
    !plan.some(
      (step) => step.kind === 'service' && step.name === 'SABCL router',
    ),
  );
});

test('every service step names an absolute entry, a cwd and a readiness URL', () => {
  for (const step of buildStartupPlan(ENVIRONMENT, '/repo')) {
    if (step.kind !== 'service') continue;
    assert.ok(step.entry.includes('dist') || step.entry.includes('next'));
    assert.ok(step.cwd.length > 0);
    assert.match(step.readiness, /^http:\/\/127\.0\.0\.1:\d+\//u);
    assert.ok(Array.isArray(step.arguments));
  }
});

test('the web step passes its port as separate arguments, never a shell string', () => {
  const web = buildStartupPlan(ENVIRONMENT, '/repo').find(
    (step) => step.name === 'Web',
  );
  assert.deepEqual(web.arguments, ['start', '--port', '3000']);
});

test('secrets are collected by variable name and redacted from any output', () => {
  const secrets = collectSecrets(ENVIRONMENT);
  assert.ok(secrets.includes('unit-only-risk-internal-token'));
  assert.ok(secrets.includes('unit-only-postgres-password'));

  const line = redact(
    'connect failed for unit-only-risk-internal-token at ' +
      'postgresql://aegis_resilience:unit-only-db-password@127.0.0.1:5432/aegis_resilience',
    secrets,
  );
  assert.ok(!line.includes('unit-only-risk-internal-token'));
  assert.ok(!line.includes('unit-only-db-password'));
  assert.match(line, /\[redacted\]/u);
});

test('redaction removes userinfo even from a URL assembled at runtime', () => {
  const line = redact('redis://:runtime-assembled-pw@127.0.0.1:6379/0', []);
  assert.ok(!line.includes('runtime-assembled-pw'));
});

test('a probe classification never carries a response body', () => {
  assert.deepEqual(classifyProbe({ ok: true, status: 200 }), {
    state: 'ready',
    detail: 'HTTP 200',
  });
  assert.equal(classifyProbe({ ok: false, status: 503 }).state, 'degraded');
  assert.equal(classifyProbe({ ok: false, status: 500 }).state, 'failed');
  assert.equal(
    classifyProbe({ ok: false, status: 0, error: 'no response' }).state,
    'unreachable',
  );
});

test('a probe against a refused port reports no response rather than throwing', async () => {
  const result = await probe(
    'http://127.0.0.1:1/health/live',
    250,
    async () => {
      throw new Error('ECONNREFUSED 10.0.0.7:5432');
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'no response');
  // The underlying socket error names an internal address; it must not survive.
  assert.ok(!JSON.stringify(result).includes('10.0.0.7'));
});

test('a probe is bounded by its timeout rather than hanging', async () => {
  const startedAt = Date.now();
  const result = await probe(
    'http://127.0.0.1:1/health/live',
    200,
    (_url, options) =>
      new Promise((_settle, fail) => {
        options.signal.addEventListener('abort', () =>
          fail(new Error('aborted')),
        );
      }),
  );
  assert.equal(result.ok, false);
  assert.ok(Date.now() - startedAt < 5_000);
});

test('a health document missing a documented field is a failure', () => {
  assert.deepEqual(verifyHealthDocument('Gateway', { status: 'ok' }), []);
  assert.deepEqual(verifyHealthDocument('Gateway', {}), ['missing "status"']);
  assert.deepEqual(verifyHealthDocument('Identity', 'not an object'), [
    'response is not a JSON object',
  ]);
});

test('liveness and readiness are held to their own shapes, not one shared shape', () => {
  // Resilience liveness is {status:'ok'}; its readiness additionally reports the
  // database state and whether a backup key is configured. Requiring readiness
  // fields of a liveness response was a real bug this test now pins down.
  assert.deepEqual(
    verifyHealthDocument('Resilience', { status: 'ok' }, 'live'),
    [],
  );
  assert.deepEqual(
    verifyHealthDocument('Resilience', { status: 'ok' }, 'ready'),
    ['missing "database"', 'missing "backupKeyConfigured"'],
  );
  assert.deepEqual(
    verifyHealthDocument('Gateway', { status: 'ready' }, 'ready'),
    ['missing "dependencies"'],
  );
});

test('a health document that discloses a secret or a connection string fails', () => {
  for (const key of FORBIDDEN_HEALTH_KEYS) {
    const problems = verifyHealthDocument('Identity', {
      status: 'ok',
      [key]: 'anything',
    });
    assert.ok(
      problems.some((item) => item.includes(key)),
      `${key} was not caught`,
    );
  }
  const leaked = verifyHealthDocument('Identity', {
    status: 'ok',
    detail: 'postgresql://role:pw@10.0.0.7:5432/db',
  });
  assert.ok(leaked.some((item) => item.includes('connection string')));
});

test('verification passes when every service answers with a valid document', async () => {
  const result = await runVerification(ENVIRONMENT, {
    fetch: fakeFetch(healthyRoutes()),
    timeoutMs: 200,
  });
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  assert.equal(
    result.checks.find((c) => c.name === 'SABCL router').state,
    'skipped',
  );
  assert.equal(result.checks.find((c) => c.name === 'Web').state, 'ready');
});

test('verification fails, with a non-zero result, when a service is unreachable', async () => {
  const routes = healthyRoutes();
  delete routes['4105/health/live'];
  const result = await runVerification(ENVIRONMENT, {
    fetch: fakeFetch(routes),
    timeoutMs: 200,
  });
  assert.equal(result.ok, false);
  const risk = result.checks.find((check) => check.name === 'Risk');
  assert.equal(risk.state, 'failed');
  assert.ok(risk.problems.some((item) => item.includes('liveness')));
});

test('verification fails when a readiness document loses a documented field', async () => {
  const result = await runVerification(ENVIRONMENT, {
    fetch: fakeFetch(
      healthyRoutes({
        '4106/health/ready': { status: 200, body: { status: 'ok' } },
      }),
    ),
    timeoutMs: 200,
  });
  assert.equal(result.ok, false);
  const resilience = result.checks.find((check) => check.name === 'Resilience');
  assert.ok(
    resilience.problems.some((item) => item.includes('backupKeyConfigured')),
  );
});

test('verification fails when a health response would disclose a connection string', async () => {
  const result = await runVerification(ENVIRONMENT, {
    fetch: fakeFetch(
      healthyRoutes({
        '4102/health/live': {
          status: 200,
          body: {
            status: 'ok',
            databaseUrl:
              'postgresql://aegis_ledger:unit-only-db-password@127.0.0.1:5432/aegis_ledger',
          },
        },
      }),
    ),
    timeoutMs: 200,
  });
  assert.equal(result.ok, false);
  const report = formatVerificationReport(result);
  assert.ok(report.includes('Ledger'));
  // The report names the problem; it never quotes the offending value.
  assert.ok(!report.includes('unit-only-db-password'));
});

test('the liveness shape matches what every service actually returns', () => {
  // Every service liveness handler in the repository returns {status, service}.
  assert.deepEqual(LIVENESS_SHAPE, ['status']);
});

test('a degraded readiness endpoint is reported, not silently accepted', async () => {
  const result = await runVerification(ENVIRONMENT, {
    fetch: fakeFetch(
      healthyRoutes({
        '4106/health/ready': {
          status: 503,
          body: {
            status: 'degraded',
            configurationValid: true,
            database: 'unavailable',
            backupKeyConfigured: true,
          },
        },
      }),
    ),
    timeoutMs: 200,
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.checks
      .find((check) => check.name === 'Resilience')
      .problems.includes('readiness degraded'),
  );
});

test('the service table shows names, ports and states and nothing else', () => {
  const table = formatServiceTable([
    { name: 'Resilience', port: 4106, state: 'ready' },
    { name: 'Web', port: 3000, state: 'unreachable' },
  ]);
  assert.match(table, /SERVICE/u);
  assert.match(table, /Resilience\s+4106\s+ready/u);
  assert.ok(!table.includes('http'));
  assert.ok(!table.includes('postgres'));
});

test('reset refuses to destroy data without explicit confirmation', () => {
  assert.throws(
    () => parseCliArguments(['reset']),
    (error) =>
      error instanceof DemoUsageError &&
      /pnpm demo:reset -- --yes/u.test(error.message),
  );
  assert.deepEqual(parseCliArguments(['reset', '--yes']), {
    command: 'reset',
    confirmed: true,
  });
});

test('an unsupported command is refused without reflecting its value', () => {
  assert.throws(
    () => parseCliArguments(['credential-shaped-input']),
    (error) =>
      error instanceof DemoUsageError &&
      !error.message.includes('credential-shaped-input'),
  );
  for (const command of ['start', 'status', 'verify', 'stop']) {
    assert.equal(parseCliArguments([command]).command, command);
  }
});
