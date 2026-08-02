import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  EVIDENCE_DIRECTORY,
  EVIDENCE_PAGES,
  FORBIDDEN_TEXT_PATTERNS,
  VIEWPORTS,
  buildPlaywrightInvocation,
  evidenceFileName,
  expectedEvidenceFiles,
  formatEvidenceNotice,
  main,
  scanCapturedText,
} from './evidence.mjs';

/*
 * Evidence tooling tests.
 *
 * Every test here is about what must NOT happen: no secret captured, no
 * automatic commit, no upload, no non-deterministic file name, and no run that
 * quietly succeeds while a page rendered a one-time code.
 */

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

test('file names are deterministic, ordered and viewport-tagged', () => {
  assert.equal(evidenceFileName('home', 'desktop'), '01-home-desktop.png');
  assert.equal(evidenceFileName('home', 'mobile'), '01-home-mobile.png');
  assert.equal(
    evidenceFileName('sign-in', 'desktop'),
    '02-sign-in-desktop.png',
  );
  // Re-running must overwrite rather than accumulate, so no timestamp.
  assert.equal(
    evidenceFileName('home', 'desktop'),
    evidenceFileName('home', 'desktop'),
  );
  assert.ok(!evidenceFileName('home', 'desktop').match(/\d{4}-\d{2}-\d{2}/u));
});

test('an unknown page or viewport is refused rather than guessed at', () => {
  assert.throws(
    () => evidenceFileName('accounts', 'desktop'),
    /Unknown evidence page/u,
  );
  assert.throws(() => evidenceFileName('home', 'watch'), /Unknown viewport/u);
});

test('every page is captured at both a desktop and a mobile viewport', () => {
  assert.deepEqual(
    VIEWPORTS.map((viewport) => viewport.name),
    ['desktop', 'mobile'],
  );
  const files = expectedEvidenceFiles();
  assert.equal(files.length, EVIDENCE_PAGES.length * 2);
  assert.equal(new Set(files).size, files.length, 'file names collide');
  assert.ok(files.some((name) => name.endsWith('-mobile.png')));
  assert.ok(VIEWPORTS.find((v) => v.name === 'mobile').width <= 430);
});

test('every captured route is a real, unauthenticated page', () => {
  // Everything under /app is behind an authentication redirect, so capturing it
  // would file a screenshot of the sign-in page under another page's name.
  const routes = EVIDENCE_PAGES.map((page) => page.route);
  for (const route of routes) {
    assert.ok(
      !route.startsWith('/app'),
      `${route} is behind the authenticated layout`,
    );
  }
  for (const forbidden of [
    '/app/accounts/',
    '/app/transfers/',
    '/security-ops/incidents/',
    '/security-ops/resilience',
  ]) {
    assert.ok(
      !routes.some((route) => route.startsWith(forbidden)),
      `${forbidden} is captured but renders customer or incident detail`,
    );
  }
  assert.deepEqual(routes, [
    '/',
    '/sign-in',
    '/onboarding',
    '/security-ops/sign-in',
  ]);
});

test('every captured route corresponds to a page that exists', () => {
  // Guards against the routes drifting from the app directory, which is how the
  // capture set came to name five pages that live under /app.
  const appDirectory = resolve(repositoryRoot, 'apps', 'web', 'src', 'app');
  for (const page of EVIDENCE_PAGES) {
    const segment = page.route === '/' ? '' : page.route;
    assert.ok(
      existsSync(resolve(appDirectory, `.${segment}`, 'page.tsx')),
      `${page.route} has no page.tsx`,
    );
  }
});

test('sensitive page text is detected and reported by name only', () => {
  const cases = [
    ['a one-time code of 483920 was sent', 'one-time code'],
    ['PIN: 1234', 'PIN'],
    ['aegis_session=abcdef0123456789', 'session cookie'],
    ['aegis_operator_csrf=abcdef0123456789', 'CSRF token'],
    ['x-aegis-internal-token: something', 'internal token'],
    ['Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6', 'bearer token'],
    ['postgresql://role:pw@127.0.0.1:5432/db', 'connection string'],
    ['LK00 1234 5678 9012', 'account reference'],
    ['-----BEGIN PRIVATE KEY-----', 'private key'],
  ];
  for (const [text, expected] of cases) {
    const found = scanCapturedText(text);
    assert.ok(found.includes(expected), `${expected} was not detected`);
    // The finding names the category; it must never echo the value.
    assert.ok(!found.join(' ').includes('483920'));
    assert.ok(!found.join(' ').includes('eyJhbGciOiJIUzI1NiIsInR5cCI6'));
  }
});

test('ordinary page text and masked previews are not flagged', () => {
  for (const safe of [
    'Send money securely',
    'Balance LKR 12,500.00',
    'Account LK00…9012',
    'Your session expires in 15 minutes',
    'AEGIS Shield',
  ]) {
    assert.deepEqual(scanCapturedText(safe), [], `flagged: ${safe}`);
  }
});

test('every forbidden pattern is named and none is a catch-all', () => {
  for (const entry of FORBIDDEN_TEXT_PATTERNS) {
    assert.ok(entry.name.length > 0);
    assert.ok(entry.pattern instanceof RegExp);
    // A pattern that matched empty text would flag every page.
    assert.equal(
      entry.pattern.test(''),
      false,
      `${entry.name} matches empty text`,
    );
  }
});

test('the evidence directory is git-ignored', () => {
  const ignored = readFileSync(resolve(repositoryRoot, '.gitignore'), 'utf8');
  assert.ok(
    ignored
      .split(/\r?\n/u)
      .some((line) => line.trim() === `${EVIDENCE_DIRECTORY}/`),
    `${EVIDENCE_DIRECTORY}/ is not in .gitignore`,
  );
});

test('the notice demands manual review and states nothing was committed or uploaded', () => {
  const notice = formatEvidenceNotice(expectedEvidenceFiles());
  assert.match(notice, /MANUAL REVIEW REQUIRED/u);
  assert.match(notice, /not been reviewed by a person/u);
  assert.match(notice, /git-ignored/u);
  assert.match(notice, /nothing was uploaded/u);
});

test('the capture is invoked with an argument array and never a shell string', () => {
  const invocation = buildPlaywrightInvocation(repositoryRoot);
  assert.equal(invocation.command, 'pnpm');
  assert.ok(Array.isArray(invocation.arguments));
  assert.deepEqual(invocation.arguments.slice(-2), ['--grep', '@evidence']);
  assert.equal(invocation.options.cwd, repositoryRoot);
});

test('nothing in the tool commits, pushes or uploads', () => {
  const source = readFileSync(
    resolve(repositoryRoot, 'infra', 'scripts', 'evidence.mjs'),
    'utf8',
  );
  // Checked against real API usage rather than prose: the notice text itself
  // contains the words "committed" and "uploaded", and saying so is the point.
  const forbiddenApis = [
    {
      name: 'a git invocation',
      pattern: /['"`]git['"`]|git\s+(add|commit|push)/u,
    },
    {
      name: 'an HTTP request',
      pattern: /\bfetch\s*\(|node:https?|require\(['"]https?['"]\)/u,
    },
    { name: 'a second child process', pattern: /exec(Sync|File)?\s*\(/u },
  ];
  for (const { name, pattern } of forbiddenApis) {
    assert.ok(!pattern.test(source), `evidence tooling uses ${name}`);
  }
  // Exactly one child-process API is imported, and the only command it is ever
  // given is the Playwright capture built above.
  const imports = source.match(/from 'node:child_process'/gu) ?? [];
  assert.equal(imports.length, 1);
  assert.match(source, /import \{ spawnSync \} from 'node:child_process';/u);
  const commands = source.match(/command:\s*'[^']+'/gu) ?? [];
  assert.deepEqual(commands, ["command: 'pnpm'"]);
});

test('a failed capture produces no evidence and a non-zero result', () => {
  const lines = [];
  const code = main((line) => lines.push(line), {
    repositoryRoot,
    run: () => ({ status: 1 }),
  });
  assert.equal(code, 1);
  assert.ok(lines.some((line) => line.includes('no evidence was produced')));
  assert.ok(!lines.some((line) => line.includes('MANUAL REVIEW')));
});

test('a successful capture reports the notice and returns zero', () => {
  const lines = [];
  const code = main((line) => lines.push(line), {
    repositoryRoot,
    run: () => ({ status: 0 }),
  });
  assert.equal(code, 0);
  assert.ok(lines.join('\n').includes('MANUAL REVIEW REQUIRED'));
  assert.ok(lines.join('\n').includes('synthetic data only'));
});
