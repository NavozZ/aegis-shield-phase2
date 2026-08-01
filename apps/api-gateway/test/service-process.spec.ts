import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_CAPTURED_BYTES,
  REDACTED,
  sanitiseServiceOutput,
  startService,
  stopService,
  tailLines,
  waitForService,
} from './service-process';

/*
 * The startup-diagnostics helper.
 *
 * These are unit tests: they spawn tiny throwaway Node scripts rather than real
 * services, so they need no database, no Redis and no ports.
 *
 * The point of the suite is that the helper must be safe to point at a real
 * service's output. A diagnostic that leaks a database password into a public
 * CI log is worse than the opaque message it replaced.
 */

const environment: NodeJS.ProcessEnv = {
  PAYMENTS_DATABASE_URL:
    'postgresql://aegis_payments:sup3r-s3cret-payments-pw@127.0.0.1:5432/aegis_payments?schema=app',
  REDIS_URL: 'redis://:sup3r-s3cret-redis-pw@127.0.0.1:6379/0',
  PAYMENTS_INTERNAL_TOKEN: 'ci-only-payments-internal-token',
  PAYMENTS_QR_SIGNING_KEY: 'ci-only-qr-signing-key-value',
  USSD_PROVIDER_SECRET: 'ci-only-ussd-provider-secret',
  FIELD_ENCRYPTION_KEY: 'ci-only-field-encryption-key',
};

describe('sanitiseServiceOutput', () => {
  it('redacts secret values that appear anywhere in the output', () => {
    const raw = [
      `Connecting to ${environment.PAYMENTS_DATABASE_URL}`,
      `redis at ${environment.REDIS_URL}`,
      `token=${environment.PAYMENTS_INTERNAL_TOKEN}`,
      `signing with ${environment.PAYMENTS_QR_SIGNING_KEY}`,
      `ussd secret ${environment.USSD_PROVIDER_SECRET}`,
    ].join('\n');

    const clean = sanitiseServiceOutput(raw, environment);

    expect(clean).not.toContain('sup3r-s3cret-payments-pw');
    expect(clean).not.toContain('sup3r-s3cret-redis-pw');
    expect(clean).not.toContain('ci-only-payments-internal-token');
    expect(clean).not.toContain('ci-only-qr-signing-key-value');
    expect(clean).not.toContain('ci-only-ussd-provider-secret');
    expect(clean).toContain(REDACTED);
  });

  it('redacts credentials in a connection string it has never seen', () => {
    // The environment-value rule cannot help here: this URL is not configured
    // anywhere. The URL rule has to catch it structurally.
    const clean = sanitiseServiceOutput(
      'ECONNREFUSED postgresql://someuser:unknown-password@db.internal:5432/x',
      environment,
    );
    expect(clean).not.toContain('unknown-password');
    expect(clean).not.toContain('someuser');
    expect(clean).toContain('postgresql://');
    // The host survives, because that is what makes the error diagnosable.
    expect(clean).toContain('db.internal:5432');
  });

  it('redacts password-only URL credentials', () => {
    const clean = sanitiseServiceOutput(
      'redis://:another-unknown-password@cache.internal:6379/0',
      environment,
    );
    expect(clean).not.toContain('another-unknown-password');
  });

  it('redacts assignments whose name marks the value sensitive', () => {
    const raw = [
      'POSTGRES_PASSWORD=hunter2hunter2',
      'IDENTITY_INTERNAL_TOKEN: abc123def456',
      '"sessionToken": "s3ss10n-value-here"',
      'OTP_CODE=482913',
      'customerPin=739182',
      'X_API_KEY = key-material-here',
    ].join('\n');

    const clean = sanitiseServiceOutput(raw, environment);

    expect(clean).not.toContain('hunter2hunter2');
    expect(clean).not.toContain('abc123def456');
    expect(clean).not.toContain('s3ss10n-value-here');
    expect(clean).not.toContain('482913');
    expect(clean).not.toContain('739182');
    expect(clean).not.toContain('key-material-here');
    // The names survive; only the values go.
    expect(clean).toContain('POSTGRES_PASSWORD');
    expect(clean).toContain('OTP_CODE');
  });

  it('redacts cookie headers in either direction', () => {
    const clean = sanitiseServiceOutput(
      [
        'set-cookie: aegis_session=abcdefghijklmnop; HttpOnly; Path=/',
        'cookie: aegis_csrf=qrstuvwxyz012345',
      ].join('\n'),
      environment,
    );
    expect(clean).not.toContain('abcdefghijklmnop');
    expect(clean).not.toContain('qrstuvwxyz012345');
  });

  it('keeps the diagnostic content that makes a failure identifiable', () => {
    // This is the real error the fix in this branch addresses. Every part an
    // engineer needs must survive sanitisation.
    const raw =
      "UnknownDependenciesException [Error]: Nest can't resolve dependencies " +
      'of the UssdService (PrismaService, RedisService, ?). Please make sure ' +
      'that the argument LedgerClient at index [2] is available in the ' +
      'UssdModule module.';
    const clean = sanitiseServiceOutput(raw, environment);
    expect(clean).toContain('UnknownDependenciesException');
    expect(clean).toContain('UssdService');
    expect(clean).toContain('LedgerClient');
    expect(clean).toContain('UssdModule');
  });

  it('ignores short environment values that would over-match', () => {
    // A one or two character value would redact half the log.
    const clean = sanitiseServiceOutput('a listener on port 4104', {
      LEDGER_DEFAULT_CURRENCY: 'LKR',
      PAYMENTS_INTERNAL_TOKEN: '41',
    });
    expect(clean).toContain('a listener on port 4104');
  });

  it('strips ANSI colouring', () => {
    const escape = String.fromCharCode(27);
    const clean = sanitiseServiceOutput(
      `${escape}[32mStarting Nest application...${escape}[39m`,
      environment,
    );
    expect(clean).toBe('Starting Nest application...');
  });
});

describe('tailLines', () => {
  it('keeps the last lines, which is where the error is', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const tail = tailLines(text, 5);
    expect(tail).toContain('line 99');
    expect(tail).not.toContain('line 50');
    expect(tail).toContain('95 earlier lines omitted');
  });

  it('does not annotate when nothing was dropped', () => {
    expect(tailLines('only line', 5)).toBe('only line');
  });

  it('drops blank lines so the budget is spent on content', () => {
    expect(tailLines('a\n\n\n\nb', 5)).toBe('a\nb');
  });
});

describe('startService and waitForService', () => {
  let directory: string;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'aegis-service-process-'));
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function script(name: string, source: string): string {
    const path = join(directory, name);
    writeFileSync(path, source, 'utf8');
    return path;
  }

  it('reports the exit code and a sanitised tail when a service dies', async () => {
    const entry = script(
      'dies.cjs',
      `console.error("connecting to " + process.env.PAYMENTS_DATABASE_URL);
       console.error("UnknownDependenciesException: cannot resolve LedgerClient");
       process.exit(3);`,
    );
    const service = startService({
      name: 'Payments',
      entry,
      cwd: directory,
      environment,
    });

    await expect(
      waitForService(service, 'http://127.0.0.1:1/health', {
        attempts: 40,
        intervalMs: 25,
      }),
    ).rejects.toThrow(/Payments exited with code 3 during startup/u);

    const message = await waitForService(service, 'http://127.0.0.1:1/health', {
      attempts: 1,
      intervalMs: 1,
    }).catch((error: Error) => error.message);

    // The cause is visible...
    expect(message).toContain('cannot resolve LedgerClient');
    // ...and the password is not.
    expect(message).not.toContain('sup3r-s3cret-payments-pw');
    await stopService(service);
  });

  it('bounds retained output so a chatty service cannot grow unbounded', async () => {
    const entry = script(
      'chatty.cjs',
      `for (let i = 0; i < 20000; i += 1) console.log("noise line " + i);
       process.exit(1);`,
    );
    const service = startService({
      name: 'Chatty',
      entry,
      cwd: directory,
      environment,
    });
    await waitForService(service, 'http://127.0.0.1:1/health', {
      attempts: 200,
      intervalMs: 25,
    }).catch(() => undefined);

    // The report is a tail, not the whole transcript.
    expect(service.output().length).toBeLessThanOrEqual(MAX_CAPTURED_BYTES);
    expect(service.output()).toContain('earlier lines omitted');
    await stopService(service);
  });

  it('reports a service that starts but never answers', async () => {
    const entry = script(
      'silent.cjs',
      `setInterval(() => {}, 1000); console.log("started but not listening");`,
    );
    const service = startService({
      name: 'Silent',
      entry,
      cwd: directory,
      environment,
    });

    await expect(
      waitForService(service, 'http://127.0.0.1:1/health', {
        attempts: 3,
        intervalMs: 10,
      }),
    ).rejects.toThrow(/Silent did not become ready/u);

    await stopService(service);
    expect(service.child.killed).toBe(true);
  });

  it('resolves once the service answers', async () => {
    const entry = script(
      'healthy.cjs',
      `const http = require("node:http");
       const server = http.createServer((_, res) => { res.writeHead(200); res.end("{}"); });
       server.listen(0, "127.0.0.1", () => console.log("PORT=" + server.address().port));`,
    );
    const service = startService({
      name: 'Healthy',
      entry,
      cwd: directory,
      environment,
    });

    // Discover the port the child chose, from its own output.
    let port: string | undefined;
    for (let attempt = 0; attempt < 200 && !port; attempt += 1) {
      port = /PORT=(\d+)/u.exec(service.output())?.[1];
      if (!port) await new Promise((settle) => setTimeout(settle, 25));
    }
    expect(port).toBeDefined();

    await expect(
      waitForService(service, `http://127.0.0.1:${port}/health`, {
        attempts: 100,
        intervalMs: 25,
      }),
    ).resolves.toBeUndefined();

    await stopService(service);
  });

  it('terminates the child and detaches listeners so Jest has no open handles', async () => {
    const entry = script(
      'lingering.cjs',
      `setInterval(() => console.log("still here"), 10);`,
    );
    const service = startService({
      name: 'Lingering',
      entry,
      cwd: directory,
      environment,
    });
    await new Promise((settle) => setTimeout(settle, 100));

    await stopService(service);

    expect(
      service.child.exitCode !== null || service.child.signalCode !== null,
    ).toBe(true);
    expect(service.child.stdout?.listenerCount('data') ?? 0).toBe(0);
    expect(service.child.stderr?.listenerCount('data') ?? 0).toBe(0);
    expect(service.child.stdout?.destroyed).toBe(true);
  });

  it('leaves no pending timer behind when the child exits promptly', async () => {
    // The shutdown path races "child exited" against a multi-second timeout.
    // If the losing timer is not cleared, Jest reports "did not exit one second
    // after the test run has completed" — an open handle created by the very
    // helper meant to make failures diagnosable.
    const entry = script('prompt.cjs', 'process.exit(0);');
    const service = startService({
      name: 'Prompt',
      entry,
      cwd: directory,
      environment,
    });
    await new Promise((settle) => setTimeout(settle, 150));

    const before = process
      .getActiveResourcesInfo()
      .filter((r) => r === 'Timeout').length;
    await stopService(service);
    const after = process
      .getActiveResourcesInfo()
      .filter((r) => r === 'Timeout').length;

    expect(after).toBeLessThanOrEqual(before);
  });

  it('is safe to stop a service twice, or one that already exited', async () => {
    const entry = script('quick.cjs', 'process.exit(0);');
    const service = startService({
      name: 'Quick',
      entry,
      cwd: directory,
      environment,
    });
    await new Promise((settle) => setTimeout(settle, 200));
    await expect(stopService(service)).resolves.toBeUndefined();
    await expect(stopService(service)).resolves.toBeUndefined();
    await expect(stopService(undefined)).resolves.toBeUndefined();
  });
});
